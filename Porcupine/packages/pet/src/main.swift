import AppKit
import CoreGraphics

// Porcupine Pet - v4
//
//   fly      : 24fps sprite, window interpolated at display rate, rests between legs
//   click    : speaks, the think box unfolds, stays 5s, folds away
//   drag     : follows the cursor
//   rest     : lands on a screen edge, materialises a plank, a bowl appears, eats,
//              then plank and bowl break apart into pixels and it flies off
//   right    : size, level, speak, rest now, fly, quit
//
// Rest art comes from the two sheets: perch/ is the plank building up and dissolving,
// rest/ is the bowl appearing, the bird eating, and everything dissolving. Every frame
// is registered on the plank's bottom edge, so the platform never moves while the head
// dips into the bowl.
//
// The bird is drawn facing left in the art, so resting on the RIGHT edge is the plain
// orientation and resting on the LEFT edge is the mirrored one. One flag drives both
// the resting side and the drawing orientation.

/// Where the pet keeps its assets. For development that is ~/wallpaper-lab/pet; once the pet
/// ships inside Porcupine, the extension builds it into a user data directory and points here
/// with PORCUPINE_PET_HOME, so nothing has to live in a developer home folder.
func resolvePetHome() -> String {
    if let env = ProcessInfo.processInfo.environment["PORCUPINE_PET_HOME"], !env.isEmpty {
        return env
    }
    if let exe = Bundle.main.executableURL {
        let candidate = exe.deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent().path
        if FileManager.default.fileExists(atPath: candidate + "/resources/pet/porcupine") { return candidate }
    }
    return NSHomeDirectory() + "/wallpaper-lab/pet"
}

let kPetHome = resolvePetHome()
let kFramesDir = kPetHome + "/resources/pet/macaw"   // the macaw flight sprite (f-NN.png)
let kRestDir = kPetHome + "/rest"
let kPerchDir = kPetHome + "/perch"
let kFPS = 24.0
let kSpeakSeconds = 5.0
let kRefreshSeconds = 1.0

let kBirdX: CGFloat = 4, kBirdY: CGFloat = 6, kBirdSlot: CGFloat = 84
let kMaskCells = 24
// the perched bird's height inside the rest frames, used to match the flying size
let kRestBirdPx: CGFloat = 430
let kPlankAnchorX: CGFloat = 0.50, kPlankAnchorY: CGFloat = 0.82

struct Sprite {
    var frames: [CGImage] = []
    var masks: [[Bool]] = []
    /// Per frame: the rectangle the bird's pixels actually occupy, in art pixels.
    /// The sprites carry large transparent margins, so this is what the screen edges
    /// must be measured against, not the window.
    var inkBBoxes: [CGRect] = []
    var size: CGSize = .zero

    static func load() -> Sprite { load(dir: kFramesDir, prefix: "f") }

    static func load(dir: String, prefix: String) -> Sprite {
        var s = Sprite()
        var i = 0
        while true {
            let path = String(format: "%@/%@-%02d.png", dir, prefix, i)
            guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
                  let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { break }
            s.frames.append(img)
            let mask = Sprite.coverage(of: img)
            s.masks.append(mask)
            s.inkBBoxes.append(Sprite.inkBBox(mask, img.width, img.height))
            if s.size == .zero { s.size = CGSize(width: img.width, height: img.height) }
            i += 1
        }
        return s
    }

    /// Ink bounds in art pixels, derived from the coverage grid (one cell of slack).
    static func inkBBox(_ mask: [Bool], _ w: Int, _ h: Int) -> CGRect {
        let n = kMaskCells
        let cellW = CGFloat(w) / CGFloat(n), cellH = CGFloat(h) / CGFloat(n)
        var minC = n, maxC = -1, minR = n, maxR = -1
        for r in 0..<n {
            for c in 0..<n where mask[r * n + c] {
                minC = min(minC, c); maxC = max(maxC, c)
                minR = min(minR, r); maxR = max(maxR, r)
            }
        }
        guard maxC >= 0 else { return CGRect(x: 0, y: 0, width: w, height: h) }
        return CGRect(x: CGFloat(minC) * cellW, y: CGFloat(minR) * cellH,
                      width: CGFloat(maxC - minC + 1) * cellW,
                      height: CGFloat(maxR - minR + 1) * cellH)
    }

    static func coverage(of img: CGImage) -> [Bool] {
        let n = kMaskCells
        var buf = [UInt8](repeating: 0, count: n * n * 4)
        guard let ctx = CGContext(data: &buf, width: n, height: n, bitsPerComponent: 8,
                                  bytesPerRow: n * 4, space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
            return [Bool](repeating: true, count: n * n)
        }
        ctx.interpolationQuality = .medium
        ctx.draw(img, in: CGRect(x: 0, y: 0, width: n, height: n))
        var out = [Bool](repeating: false, count: n * n)
        for i in 0..<(n * n) where buf[i * 4 + 3] > 70 { out[i] = true }
        return out
    }

    /// Fraction of dark ink in the left third vs the right third of the sprite, on a coarse
    /// colour grid. "Dark" is luminance < 90/255 -- the deep brown of the quills and the
    /// shadow between them, which a quill end has more of than a face does. This is the
    /// measured discriminator for which way a side-on walker faces; returns nil when the
    /// sprite is too small or one end is empty.
    static func darkFractionEnds(of img: CGImage) -> (left: Double, right: Double)? {
        // A FINE grid. The 24-cell coverage mask is far too coarse for this: downsampled to
        // 24x24 the two thirds differ by less than one cell and the answer flips with the
        // frame (measured: walk-0 0.474 vs 0.463). 96x96 resolves the quill highlights from
        // the face and the same clip then measures 0.60 vs 0.44.
        let n = 96
        var buf = [UInt8](repeating: 0, count: n * n * 4)
        guard let ctx = CGContext(data: &buf, width: n, height: n, bitsPerComponent: 8,
                                  bytesPerRow: n * 4, space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
            return nil
        }
        ctx.interpolationQuality = .medium
        ctx.draw(img, in: CGRect(x: 0, y: 0, width: n, height: n))
        // Only count INK columns: find the leftmost and rightmost ink column, then take the
        // outer third of THAT span. Otherwise a clip drawn with a wide transparent margin
        // spends two thirds of the grid on emptiness and the ends are both background.
        var minC = n, maxC = -1
        for r in 0..<n {
            for c in 0..<n where buf[(r * n + c) * 4 + 3] > 70 {
                if c < minC { minC = c }
                if c > maxC { maxC = c }
            }
        }
        guard maxC - minC > 8 else { return nil }
        let third = max(1, (maxC - minC + 1) / 3)
        let leftEnd = minC + third, rightStart = maxC - third + 1
        var dark = [0, 0], ink = [0, 0]
        for r in 0..<n {
            for c in 0..<n {
                let i = (r * n + c) * 4
                guard buf[i + 3] > 70 else { continue }
                let side: Int
                if c < leftEnd { side = 0 } else if c >= rightStart { side = 1 } else { continue }
                let lum = (30 * Int(buf[i]) + 59 * Int(buf[i + 1]) + 11 * Int(buf[i + 2])) / 100
                ink[side] += 1
                if lum < 90 { dark[side] += 1 }
            }
        }
        guard ink[0] > 4, ink[1] > 4 else { return nil }
        return (Double(dark[0]) / Double(ink[0]), Double(dark[1]) / Double(ink[1]))
    }
}

/// Visible height of the bird in an image, in art pixels: topmost to bottommost pixel
/// that is not transparent. This is the dimension the eye reads as "how big is that
/// parrot", so matching it between sheets is what keeps the size constant when the pet
/// lands, eats, or speaks. Guessed heights are what made the perched bird 1.4x too big.
func birdHeight(of img: CGImage) -> CGFloat {
    let w = max(1, img.width / 4), h = max(1, img.height / 4)
    var buf = [UInt8](repeating: 0, count: w * h * 4)
    guard let ctx = CGContext(data: &buf, width: w, height: h, bitsPerComponent: 8,
                              bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(),
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return 0 }
    ctx.interpolationQuality = .high
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
    var top = h, bottom = -1
    for y in 0..<h {
        for x in 0..<w where buf[(y * w + x) * 4 + 3] > 90 {
            if y < top { top = y }
            if y > bottom { bottom = y }
            break
        }
    }
    return bottom < 0 ? 0 : CGFloat((bottom - top + 1) * 4)   // back to art pixels
}

/// How many Porcupine sessions are live, for the Dock badge. Same source the think box
/// uses, read defensively: a malformed feed must never take the pet down.
func activeSessionCount() -> Int {
    let task = Process()
    task.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
    task.arguments = [kPetHome + "/pet-status.py"]
    let pipe = Pipe(); task.standardOutput = pipe; task.standardError = Pipe()
    do { try task.run() } catch { return 0 }
    task.waitUntilExit()
    let out = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    for line in out.split(separator: "\n") where line.hasPrefix("SUBAGENTS") {
        let tail = line.split(separator: "|").last.map(String.init) ?? ""
        if let range = tail.range(of: "session(s)") {
            let before = tail[..<range.lowerBound].trimmingCharacters(in: .whitespaces)
            if let last = before.split(separator: " ").last, let n = Int(last) { return n }
        }
    }
    return 0
}

func median(_ xs: [CGFloat]) -> CGFloat {
    guard !xs.isEmpty else { return 0 }
    let s = xs.sorted()
    return s[s.count / 2]
}

/// One cut animation: frames plus the metadata that says where its anchor is and how
/// tall the bird is inside it, so every clip lands in the same place at the same size.
struct Clip {
    var name: String
    var frames: [CGImage]
    var masks: [[Bool]]
    var inkBBoxes: [CGRect]
    var size: CGSize
    var anchorX: CGFloat            // fractions, top-down like the art
    var anchorY: CGFloat
    var birdHeightPx: CGFloat
    var kind: String = "plank"
    var bodyWidthPx: CGFloat = 0
    /// True when the sprite is drawn facing left. Measured from the ink, because assuming
    /// it wrong is exactly how the pet ended up moonwalking: moving right while drawn
    /// facing right.
    var artFacesLeft: Bool = true

    /// Decide which way the art faces, from the COLOUR of the ink at each end.
    ///
    /// The old version counted coverage cells at the left and right edges and guessed the
    /// head was the sparser end. Measured on the real walk clip that margin is 1 cell out of
    /// 24 (left 17 / right 16, and a dead heat of 17/17 on frame 1): it happened to be right
    /// and could as easily have flipped, which is how the pet moonwalked.
    ///
    /// A porcupine is a spiky back and a solid face, and the two ends differ by COLOUR, not
    /// by count: the quills are desaturated cream/white highlights over dark brown, while the
    /// face/snout is a single saturated tan. Measured on the outermost third of the ink,
    /// averaged over 8 frames of nine sheets:
    ///     quill end  dark-ink fraction ~0.60, mean saturation ~48
    ///     head  end  dark-ink fraction ~0.44, mean saturation ~70
    /// So the head is the LIGHTER end (less dark ink), and on every porcupine sheet the head
    /// is on the RIGHT: artFacesLeft == false for all of them. Measured, not assumed.
    mutating func measureFacing() {
        guard let img = frames.first else { return }
        guard let (darkL, darkR) = Sprite.darkFractionEnds(of: img) else { return }
        // the lighter end (the smaller fraction of dark ink) is the head
        artFacesLeft = darkL < darkR
    }

    /// Points per art pixel that makes this clip's bird match `targetHeightPt`.
    func scale(forBirdHeight targetHeightPt: CGFloat) -> CGFloat {
        birdHeightPx > 0 ? targetHeightPt / birdHeightPx : 1
    }

    /// Walkers are sized by BODY WIDTH, not height: legs and head change height from frame
    /// to frame, so height would make the pet pulse as it walks. Width is stable.
    func scale(forBodyWidth targetWidthPt: CGFloat) -> CGFloat {
        bodyWidthPx > 0 ? targetWidthPt / bodyWidthPx : scale(forBirdHeight: targetWidthPt)
    }
}

func loadClips(root overrideRoot: String? = nil) -> [String: Clip] {
    var out: [String: Clip] = [:]
    let root = overrideRoot ?? (kPetHome + "/clips")
    let dirs = (try? FileManager.default.contentsOfDirectory(atPath: root)) ?? []
    for d in dirs.sorted() {
        let dir = root + "/" + d
        guard let data = FileManager.default.contents(atPath: dir + "/clip.json"),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let w = json["width"] as? Int, let h = json["height"] as? Int else { continue }
        var clip = Clip(name: d, frames: [], masks: [], inkBBoxes: [],
                        size: CGSize(width: w, height: h),
                        anchorX: CGFloat(json["anchorX"] as? Double ?? 0.5),
                        anchorY: CGFloat(json["anchorY"] as? Double ?? 0.82),
                        birdHeightPx: CGFloat(json["birdHeightPx"] as? Double ?? 0),
                        kind: (json["kind"] as? String) ?? "plank",
                        bodyWidthPx: CGFloat(json["medianBodyWidthPx"] as? Double
                                             ?? json["birdHeightPx"] as? Double ?? 0))
        var i = 0
        while true {
            // walker clips are written as w-NN.png, the macaw's as r-NN.png
            var p = String(format: "%@/r-%02d.png", dir, i)
            if !FileManager.default.fileExists(atPath: p) {
                p = String(format: "%@/w-%02d.png", dir, i)
            }
            guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: p) as CFURL, nil),
                  let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { break }
            clip.frames.append(img)
            let mask = Sprite.coverage(of: img)
            clip.masks.append(mask)
            clip.inkBBoxes.append(Sprite.inkBBox(mask, img.width, img.height))
            i += 1
        }
        if !clip.frames.isEmpty {
            clip.measureFacing()
            out[d] = clip
        }
    }
    return out
}

/// A step in a rest sequence: play frames from...to, optionally looping for `hold` seconds.
struct RestStep {
    var clip: String
    var from: Int
    var to: Int
    var fps: Double
    var hold: Double? = nil
    var label: String = ""
}

final class PetView: NSView {
    let sprite: Sprite
    var frameIndex = 0
    var image: CGImage?
    var imageRect: CGRect = .zero
    var mask: [Bool] = []
    var flipX = false
    var rotation: CGFloat = 0        // degrees, for the walking waddle
    var boxOnRight = true
    var unit: CGFloat = 3.0
    var boxUnit: CGFloat = 1.5
    var rows: [BoxRow] = []
    var boxAlpha: CGFloat = 0
    var onMenu: ((NSEvent) -> Void)?
    var onClick: (() -> Void)?
    var onDrag: ((CGPoint) -> Void)?
    var onGrab: (() -> Void)?
    var onRelease: (() -> Void)?
    private var pressScreen = NSPoint.zero
    private var pressOrigin = NSPoint.zero
    private var pressTime = Date()
    private var dragDistance: CGFloat = 0

    init(frame rect: NSRect, sprite: Sprite) {
        self.sprite = sprite
        super.init(frame: rect)
        wantsLayer = true
        layer?.backgroundColor = .clear
    }
    required init?(coder: NSCoder) { fatalError() }

    override var isOpaque: Bool { false }

    func birdRect() -> CGRect {
        imageRect == .zero
            ? CGRect(x: kBirdX * unit, y: kBirdY * unit, width: kBirdSlot * unit, height: kBirdSlot * unit)
            : imageRect
    }

    /// Where the bubble goes: to the right of the bird when flying, and toward the
    /// middle of the screen when the pet is perched against an edge.
    func boxOrigin() -> CGPoint {
        let r = birdRect()
        let wide = r.width > r.height            // the walking pet: bubble sits above it
        let y = wide ? r.maxY - 10 : (r.minY + r.height * 0.42)
        if !boxOnRight {
            let x = wide ? r.minX + r.width * 0.20 : r.minX + r.width * 0.42
            return CGPoint(x: x - boxW * boxUnit, y: y)
        }
        let x = wide ? r.minX + r.width * 0.30 : r.maxX + 16
        return CGPoint(x: x, y: y)
    }

    func boxRect() -> CGRect {
        let o = boxOrigin()
        return CGRect(x: o.x - 30 * boxUnit, y: o.y - 4 * boxUnit,
                      width: boxW * boxUnit + 34 * boxUnit, height: boxH * boxUnit + 8 * boxUnit)
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }
        let img = image ?? sprite.frames[frameIndex % max(1, sprite.frames.count)]
        let r = birdRect()
        NSGraphicsContext.current?.imageInterpolation = .none
        // tilt about the feet, so a waddling walk reads even though the art is a still
        ctx.saveGState()
        ctx.translateBy(x: r.midX, y: r.minY)
        if rotation != 0 { ctx.rotate(by: rotation * .pi / 180) }
        if flipX { ctx.scaleBy(x: -1, y: 1) }
        ctx.draw(img, in: CGRect(x: -r.width / 2, y: 0, width: r.width, height: r.height))
        ctx.restoreGState()
        if boxAlpha > 0.01 && !rows.isEmpty {
            drawThinkBox(ctx, origin: boxOrigin(), unit: boxUnit, rows: rows, alpha: boxAlpha)
        }
    }

    func birdContains(_ p: CGPoint) -> Bool {
        let r = birdRect()
        guard r.contains(p) else { return false }
        let n = kMaskCells
        var fx = (p.x - r.minX) / r.width
        if flipX { fx = 1 - fx }
        let cx = min(n - 1, max(0, Int(fx * CGFloat(n))))
        let cyTop = min(n - 1, max(0, Int(((p.y - r.minY) / r.height) * CGFloat(n))))
        let idx = (n - 1 - cyTop) * n + cx
        let m = mask.isEmpty ? sprite.masks[frameIndex % max(1, sprite.masks.count)] : mask
        return idx >= 0 && idx < m.count ? m[idx] : true
    }

    override func hitTest(_ point: NSPoint) -> NSView? {
        let p = convert(point, from: superview)
        if birdContains(p) { return self }
        if boxAlpha > 0.01 && !rows.isEmpty && boxRect().contains(p) { return self }
        return nil
    }

    override func rightMouseDown(with event: NSEvent) { onMenu?(event) }

    override func mouseDown(with event: NSEvent) {
        onGrab?()
        pressScreen = NSEvent.mouseLocation
        pressOrigin = window?.frame.origin ?? .zero
        pressTime = Date()
        dragDistance = 0
    }

    override func mouseDragged(with event: NSEvent) {
        let now = NSEvent.mouseLocation
        let dx = now.x - pressScreen.x, dy = now.y - pressScreen.y
        dragDistance = max(dragDistance, sqrt(dx * dx + dy * dy))
        onDrag?(CGPoint(x: pressOrigin.x + dx, y: pressOrigin.y + dy))
    }

    override func mouseUp(with event: NSEvent) {
        onRelease?()
        if dragDistance < 4 && Date().timeIntervalSince(pressTime) < 0.6 { onClick?() }
    }
}

enum Phase { case flying, resting, departing }

/// Which pet this is. The hedgehog is the default: one static pose, so its motion is
/// synthesised (a waddle across the bottom of the screen) rather than read from frames.
enum Species: String { case porcupine, hedgehog, macaw }

func loadSpecies() -> Species {
    let p = kPetHome + "/species.txt"
    if let raw = try? String(contentsOfFile: p, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
       let sp = Species(rawValue: raw) { return sp }
    return .hedgehog
}

func saveSpecies(_ sp: Species) {
    try? sp.rawValue.write(toFile: kPetHome + "/species.txt",
                           atomically: true, encoding: .utf8)
}

/// Build a one-frame Clip from a still image, feet at the bottom edge, so the walking pet
/// can reuse the same placement, hit testing and size code the macaw uses.
func stillClip(path: String, name: String) -> Clip? {
    guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
          let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { return nil }
    let mask = Sprite.coverage(of: img)
    return Clip(name: name, frames: [img], masks: [mask],
                inkBBoxes: [Sprite.inkBBox(mask, img.width, img.height)],
                size: CGSize(width: img.width, height: img.height),
                anchorX: 0.5, anchorY: 1.0, birdHeightPx: CGFloat(img.height))
}

/// The display the pet should live on: whichever one the cursor is on, so it follows
/// the user across monitors. Falls back through first, then main, then anything.
func activeScreen() -> NSScreen {
    let mouse = NSEvent.mouseLocation
    if let s = NSScreen.screens.first(where: { NSMouseInRect(mouse, $0.frame, false) }) { return s }
    return NSScreen.screens.first ?? NSScreen.main ?? NSScreen.screens[0]
}

func screenFrame() -> NSRect { activeScreen().visibleFrame }

/// The display the pet itself is on. Using the cursor's display for clamping is wrong:
/// the pet should be bounded by whichever screen its own window occupies.
func screenFor(_ rect: NSRect) -> NSScreen {
    let centre = CGPoint(x: rect.midX, y: rect.midY)
    return NSScreen.screens.first { $0.frame.contains(centre) }
        ?? NSScreen.screens.first ?? NSScreen.main ?? NSScreen.screens[0]
}

/// Keep a window fully inside the visible area of its own display.
func clampOrigin(_ origin: CGPoint, _ size: NSSize) -> CGPoint {
    let f = screenFor(NSRect(origin: origin, size: size)).visibleFrame
    let x = min(max(origin.x, f.minX), max(f.minX, f.maxX - size.width))
    let y = min(max(origin.y, f.minY), max(f.minY, f.maxY - size.height))
    return CGPoint(x: x, y: y)
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var view: PetView!
    var sprite = Sprite.load()
    var clips: [String: Clip] = [:]
    var species = loadSpecies()
    var porcClips: [String: Clip] = [:]
    var walkClipName: String = ""
    var walkFrame = 0
    var walkClock = 0.0
    var idleTick = 0.0             // how long the pet has been resting, to rotate the idle sheet
    /// The porcupine's rest, as the user described it: walk to a corner, curl into the ball
    /// and sit there, then uncurl and eat from the bowl, then carry on. Driven by a small
    /// state machine rather than the old "sit still for a random while".
    enum WalkerRitual { case none, toCorner, curlHold, eat }
    var ritual: WalkerRitual = .none
    var curlTotal = 2.2            // seconds: 2.2 of play-in for a startle, longer holds the ball
    var eatTotal = 3.0
    var curlLeft = 0.0
    var curlLogged = false
    var curlTicks = 0
    var walkerMissLogged = false
    var beingHeld = false
    var heldLeft = 0.0
    var heldClock = 0.0
    var boxClock = 0.0
    var pickupLogged = false
    var eatLeft2 = 0.0
    var hedgehog: Clip?          // art faces left (verified against the source image)
    var walkTargetX: CGFloat = 0
    var walkRestLeft = 0.0
    var waddle = 0.0
    var facingLeft = true
    /// Sequence currently playing while the pet is perched.
    var seq: [RestStep] = []
    var stepIdx = 0
    var stepTime = 0.0

    var pos = CGPoint(x: 400, y: 400)
    var target = CGPoint(x: 400, y: 400)
    var resting = false
    var restTimer = 0.0
    var lastTick = Date()
    var frameClock = 0.0
    var frameIndex = 0
    var burst = 0.0

    var unit: CGFloat = 3.0
    var phase: Phase = .flying
    var restStage = 0                 // 0 approach, 1 plank in, 2 eat, 3 plank out
    var restTimerClock = 0.0
    var eatLeft = 0.0
    var restFlip = false              // true = left edge, mirrored art
    var restAnchor = CGPoint.zero
    var nextRest = 8.0
    var sinceRest = 0.0

    // speak box
    var inDock = true
    var speaking = false
    var speakLeft = 0.0
    var refreshAccum = 0.0
    var folding = false
    var fetching = false

    func idleSize() -> NSSize {
        NSSize(width: (kBirdX + kBirdSlot) * unit, height: (kBirdY + kBirdSlot) * unit)
    }
    /// Measured once at launch: how tall the bird is in each clip, and the resulting
    /// factor that puts the rest art at the same on-screen size as the flight art.
    var sizeRatio: CGFloat = 1
    var flightBirdPx: CGFloat = 0
    var restBirdPx: CGFloat = 0

    func measureScale() {
        var heights: [CGFloat] = []
        for i in stride(from: 0, to: sprite.frames.count, by: 3) {
            heights.append(birdHeight(of: sprite.frames[i]))
        }
        flightBirdPx = median(heights)
        NSLog("Porcupine Pet: flight bird %.0fpx tall, %d clips loaded", flightBirdPx, clips.count)
    }

    /// How tall the flying bird is on screen, in points. Every clip is scaled to this,
    /// so the parrot is one size in every animation.
    func flyingBirdHeightPt() -> CGFloat {
        guard sprite.size.width > 0 else { return 1 }
        return flightBirdPx * ((kBirdSlot * unit) / sprite.size.width)
    }

    /// The clip used to size and place the landing spot.
    var referenceClip: Clip? { clips["16"] ?? clips.sorted { $0.key < $1.key }.first?.value }

    /// Clicking the Dock icon makes the pet speak, so the icon does something useful.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        speak()
        return true
    }

    func applicationDidFinishLaunching(_ note: Notification) {
        guard !sprite.frames.isEmpty else {
            NSLog("Porcupine Pet: no frames found in \(kFramesDir)")
            NSApp.terminate(nil)
            return
        }
        // Dock / menu-bar icon. There was none; the bundle also carries Contents/Resources/
        // Pet.icns and Info.plist CFBundleIconFile, but loading it at runtime means the icon
        // shows even when the binary is launched straight from the build command.
        if let icon = NSImage(contentsOfFile: kPetHome + "/dockicon-128.png") {
            NSApp.applicationIconImage = icon
        }
        let size = idleSize()
        window = NSWindow(contentRect: NSRect(origin: pos, size: size),
                          styleMask: [.borderless], backing: .buffered, defer: false)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.level = .floating
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary]
        window.isMovableByWindowBackground = true

        view = PetView(frame: NSRect(origin: .zero, size: size), sprite: sprite)
        view.unit = unit
        view.boxUnit = boxUnitFor(unit)
        view.onMenu = { [weak self] event in self?.showMenu(event) }
        view.onClick = { [weak self] in self?.speak() }
        view.onDrag = { [weak self] origin in self?.moveTo(origin) }
        view.onGrab = { [weak self] in
            guard let self else { return }
            self.beingHeld = true
            self.heldClock = 0
            self.heldLeft = 0
            self.walkRestLeft = 0
            self.ritual = .none
            // size the window to the pickup clip so the squirming pose is not squashed
            if let pick = self.pickupClipName, let pc = self.porcClips[pick] {
                let sc = pc.scale(forBodyWidth: self.walkerWidthPt())
                let size = NSSize(width: pc.size.width * sc, height: pc.size.height * sc)
                let origin = self.window.frame.origin
                self.window.setFrame(NSRect(origin: origin, size: size), display: true)
                self.view.frame = NSRect(origin: .zero, size: size)
            }
            self.speakLog("grabbed: pickup clip \(self.pickupClipName ?? "none")")
        }
        view.onRelease = { [weak self] in
            guard let self else { return }
            self.beingHeld = false
            self.walkTargetX = 0
            self.speakLog("released")
        }
        window.contentView = view

        loadWalkerSize()
        clips = loadClips(root: kPetHome + "/resources/pet/macaw")
        // the chosen species' frames live in different folders; the macaw's are plank
        // clips with a perch, the walkers are ground sprites
        porcClips = loadClips(root: kPetHome + "/resources/pet/porcupine")
        // the walk uses its own cycle clip when it is on disk; the source-sheet clips are the idle
        walkClipName = walkCycleName ?? walkClipNames.randomElement() ?? (porcClips.keys.sorted().first ?? "")
        hedgehog = stillClip(path: kPetHome + "/resources/pet/hedgehog/sprite.png", name: "hedgehog")
        speakLog("loaded: species=\(species.rawValue) porcClips=\(porcClips.count) [\(porcClips.keys.sorted().joined(separator: " "))] walkClipName=\(walkClipName) cycle=\(walkCycleName ?? "nil")")
        measureScale()
        let screen = screenFrame()
        let scr = activeScreen()
        if species == .hedgehog || species == .porcupine {
            var w: CGFloat = 140, h: CGFloat = 110
            if species == .porcupine, let c = porcClips[walkClipName] {
                let sc = c.scale(forBodyWidth: walkerWidthPt())
                w = c.size.width * sc; h = c.size.height * sc
            } else {
                let s = walkerScale()
                w = (hedgehog?.size.width ?? 517) * s; h = (hedgehog?.size.height ?? 408) * s
            }
            pos = CGPoint(x: screen.midX, y: screen.minY + 6)
            window.setFrame(NSRect(x: pos.x - w / 2, y: pos.y, width: w, height: h), display: false)
            view.frame = NSRect(origin: .zero, size: NSSize(width: w, height: h))
        }
        let report = """
        screen frame    : \(scr.frame.width) x \(scr.frame.height) points
        visible frame   : \(screen.width) x \(screen.height) points at \(Int(screen.minX)),\(Int(screen.minY))
        backing scale   : \(scr.backingScaleFactor)x  (panel \(Int(scr.frame.width * scr.backingScaleFactor)) x \(Int(scr.frame.height * scr.backingScaleFactor)) pixels)
        displays        : \(NSScreen.screens.count)
        pet size        : bird \(Int(kBirdSlot * unit)) points tall
        bird height px  : flight \(String(format: "%.0f", flightBirdPx))  rest \(String(format: "%.0f", restBirdPx))  factor \(String(format: "%.3f", sizeRatio))
        flight px/bird  : \(String(format: "%.4f", (kBirdSlot * unit) / sprite.size.width)) points per art pixel
        species         : \(species.rawValue)
        clips loaded    : \(clips.count)
        flying bird pt  : \(String(format: "%.1f", flyingBirdHeightPt()))
        """
        try? report.write(toFile: kPetHome + "/pet-screen.txt",
                          atomically: true, encoding: .utf8)
        NSLog("Porcupine Pet: %@", report.replacingOccurrences(of: "\n", with: " | "))
        pos = CGPoint(x: screen.maxX - size.width - 90, y: screen.midY)
        target = pos
        pickTarget(screen)
        setFlightFrame()
        window.setFrameOrigin(NSPoint(x: pos.x, y: pos.y))
        window.orderFrontRegardless()

        Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
            self?.tick()
        }
        Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
            self?.updateBadge()
        }
        Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { [weak self] _ in
            guard let self else { return }
            let speakReq = kPetHome + "/speak-request"
            if FileManager.default.fileExists(atPath: speakReq) {
                try? FileManager.default.removeItem(atPath: speakReq)
                self.speakLog("channel seen: speak-request")
                self.speak()
            }
            let holdReq = kPetHome + "/hold-request"
            if FileManager.default.fileExists(atPath: holdReq) {
                try? FileManager.default.removeItem(atPath: holdReq)
                if self.species == .porcupine {
                    self.beingHeld = true
                    self.heldClock = 0
                    self.heldLeft = 6.0            // own its own for six seconds, for testing
                    self.speakLog("channel seen: hold-request")
                }
            }
            let curlReq = kPetHome + "/curl-request"
            if FileManager.default.fileExists(atPath: curlReq) {
                try? FileManager.default.removeItem(atPath: curlReq)
                self.speakLog("channel seen: curl-request (species=\(self.species.rawValue))")
                if self.species == .porcupine { self.curlLeft = 2.2 }        // startled: curl up
            }
            let restReq = kPetHome + "/rest-request"
            if FileManager.default.fileExists(atPath: restReq) {
                try? FileManager.default.removeItem(atPath: restReq)
                switch self.species {
                case .hedgehog: self.walkRestLeft = Double.random(in: 4 ... 9)   // sits a while
                case .porcupine:
                    // walk to the nearest corner, curl into the ball, then eat
                    self.ritual = .toCorner
                    let c = self.porcClips[self.walkClipName]
                    let w = (c?.size.width ?? 340) * (c?.scale(forBodyWidth: self.walkerWidthPt()) ?? 0.3)
                    self.walkTargetX = self.nearestCornerX(screenFrame(), w)
                case .macaw: if self.phase == .flying { self.nextRest = 0 }
                }
            }
        }
    }

    /// The think box scale. Walkers are small and drawn at their own size, so their bubble
    /// is smaller too: at the macaw's scale the box dwarfed the porcupine and read as a
    /// window that had appeared from nowhere rather than as the pet thinking.
    func boxUnitFor(_ u: CGFloat) -> CGFloat {
        species == .macaw ? max(1.3, min(2.1, u * 0.5)) : 1.05
    }

    /// Round a rect to whole device pixels: pixel art drawn between pixels goes soft.
    func snapToPixels(_ r: CGRect) -> CGRect {
        let scale = activeScreen().backingScaleFactor
        func snap(_ v: CGFloat) -> CGFloat { (v * scale).rounded() / scale }
        return CGRect(x: snap(r.minX), y: snap(r.minY),
                      width: snap(r.width), height: snap(r.height))
    }

    // MARK: - frames

    func setFlightFrame(resizeWindow: Bool = true) {
        let img = sprite.frames[frameIndex % max(1, sprite.frames.count)]
        let r = snapToPixels(CGRect(x: kBirdX * unit, y: kBirdY * unit,
                                    width: kBirdSlot * unit, height: kBirdSlot * unit))
        view.image = img
        view.imageRect = r
        view.mask = sprite.masks[frameIndex % max(1, sprite.masks.count)]
        view.flipX = false
        if resizeWindow && !speaking && window.frame.size != idleSize() {
            window.setFrame(NSRect(origin: window.frame.origin, size: idleSize()), display: true)
            view.frame = NSRect(origin: .zero, size: idleSize())
        }

    }

    /// Show a rest frame, keeping the plank's anchor point pinned in screen space.
    /// Repeat calls with the same index are ignored, so the window is not re-placed
    /// sixty times a second for no reason.
    var lastRestKey = ""
    func setRestFrame(_ clip: Clip, _ index: Int, flip: Bool, force: Bool = false) {
        guard index < clip.frames.count else { return }
        let key = "\(clip.name)-\(index)-\(flip)-\(unit)"
        if !force && key == lastRestKey { return }
        lastRestKey = key
        let s = clip.scale(forBirdHeight: flyingBirdHeightPt())
        let snapped = snapToPixels(CGRect(x: 0, y: 0, width: clip.size.width * s,
                                         height: clip.size.height * s))
        let w = snapped.width, h = snapped.height
        // the anchor is stored top-down like the art, view coordinates count upward
        let want = CGPoint(x: restAnchor.x - w * clip.anchorX,
                           y: restAnchor.y - h * (1 - clip.anchorY))
        let origin = clampOnInk(want, boxes: clip.inkBBoxes, artSize: clip.size,
                                index: index, scale: s, size: NSSize(width: w, height: h))
        window.setFrame(NSRect(x: origin.x, y: origin.y, width: w, height: h), display: true)
        view.frame = NSRect(origin: .zero, size: NSSize(width: w, height: h))
        view.image = clip.frames[index]
        view.mask = clip.masks[index]
        view.imageRect = NSRect(origin: .zero, size: NSSize(width: w, height: h))
        view.flipX = flip
        view.needsDisplay = true
    }

    // MARK: - resting

    func beginRest(_ screen: NSRect) {
        let ref = referenceClip
        let s = (ref?.scale(forBirdHeight: flyingBirdHeightPt()) ?? 1)
        let w = (ref?.size.width ?? 470) * s
        restFlip = Bool.random()                       // left edge (mirrored) or right edge
        let y = CGFloat.random(in: screen.minY + 90 ... max(screen.minY + 120, screen.midY))
        let overhang: CGFloat = 18                      // just enough to look attached
        let x = restFlip ? screen.minX - overhang : screen.maxX - w + overhang
        restAnchor = CGPoint(x: x + w * kPlankAnchorX, y: y + 0)
        phase = .resting
        restStage = 0
        restTimerClock = 0
        // Fly toward the perch first. The target is the *window origin* that puts the
        // flying bird's body centre beside the anchor -- using the perched clip's own
        // width here would aim at a point the wider flying window can never reach, so
        // the bird would hover at the edge forever.
        let bodyX = (kBirdX + kBirdSlot * 0.50) * unit
        let want = CGPoint(x: restAnchor.x - (restFlip ? -34 : 34) - bodyX,
                           y: restAnchor.y + 22 - (kBirdY + kBirdSlot * 0.55) * unit)
        let f = screenFor(NSRect(origin: want, size: idleSize())).visibleFrame
        target = CGPoint(x: min(max(want.x, f.minX), max(f.minX, f.maxX - idleSize().width)),
                         y: min(max(want.y, f.minY), max(f.minY, f.maxY - idleSize().height)))
        resting = false
    }

    func finishRest(_ screen: NSRect) {
        phase = .flying
        restStage = 0
        seq = []
        stepIdx = 0
        stepTime = 0
        pickTarget(screen)
        setFlightFrame()
        sinceRest = 0
        nextRest = Double.random(in: 30 ... 75)
    }

    // MARK: - speaking

    /// Put the bubble where it fits: right of the bird normally, left of it when the
    /// bird is against the right edge of its display.
    func chooseBoxSide() {
        let r = view.birdRect()
        let room = screenFor(window.frame).visibleFrame.maxX - (window.frame.origin.x + r.maxX)
        view.boxOnRight = room > boxW * view.boxUnit + 40
    }

    func speakLog(_ msg: String) {
        let line = "\(Date().timeIntervalSince1970) \(msg)\n"
        let path = kPetHome + "/pet-speak.log"
        if let fh = FileHandle(forWritingAtPath: path) {
            fh.seekToEndOfFile(); fh.write(line.data(using: .utf8)!); try? fh.close()
        } else {
            try? line.write(toFile: path, atomically: true, encoding: .utf8)
        }
    }

    func speak() {
        speakLog("speak() speaking=\(speaking) folding=\(folding) phase=\(phase) rows=\(view.rows.count) boxAlpha=\(String(format: "%.2f", view.boxAlpha))")
        speakLeft = kSpeakSeconds
        chooseBoxSide()
        folding = false
        window.alphaValue = 1
        burst = max(burst, 0.5)
        refreshRows()
        if !speaking {
            speaking = true
            let stage = stageSize()
            let origin = clampOrigin(window.frame.origin, stage)
            window.setFrame(NSRect(x: origin.x, y: origin.y, width: stage.width, height: stage.height),
                            display: true)
            view.frame = NSRect(origin: .zero, size: stage)
        }
        view.needsDisplay = true
    }

    func stageSize() -> NSSize {
        let b = view.birdRect()
        let o = view.boxOrigin()
        return NSSize(width: max(b.maxX, o.x + boxW * view.boxUnit + 6),
                      height: max(b.maxY, o.y + boxH * view.boxUnit + 6))
    }

    func refreshRows() {
        guard !fetching else { return }
        fetching = true
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let rows = fetchBoxRows()
            DispatchQueue.main.async {
                guard let self else { return }
                self.fetching = false
                if self.folding { return }
                self.view.rows = rows
                self.view.needsDisplay = true
            }
        }
    }

    func fold() { folding = true }

    func finishFold() {
        speaking = false
        folding = false
        view.rows = []
        view.boxAlpha = 0
        window.alphaValue = 1
        let size: NSSize
        if species != .macaw {
            // back to the walking pet's own footprint, not the macaw's idle window
            let c = porcClips[walkClipName] ?? porcClips.values.first
            let sc = c?.scale(forBodyWidth: walkerWidthPt()) ?? 1
            size = NSSize(width: (c?.size.width ?? 160) * sc, height: (c?.size.height ?? 140) * sc)
        } else {
            size = phase == .resting ? window.frame.size : idleSize()
        }
        window.setFrame(NSRect(origin: window.frame.origin, size: size), display: true)
        view.frame = NSRect(origin: .zero, size: size)
        view.needsDisplay = true
    }

    // MARK: - the walking pet

    /// The porcupine's own clips, now named after the SOURCE SHEET they come from, so a
    /// clip can never again be mistaken for a different sheet (the old numbers were assigned
    /// in string-sorted order, which put sheet (10) at clip 03 -- the curl misread).
    ///
    /// This list is the IDLE rotation: the sheets whose eight frames are near-identical
    /// standing poses, which is exactly what an idle wants. Every entry was checked by eye on
    /// its contact strip. Excluded, with the reason measured or seen:
    ///   sheet-10_23_57-4   turns around through a front-on bristle; the art faces right in
    ///                      frames 0-2 and LEFT in frames 5-7, so it is not a coherent walker
    ///   sheet-10_24_15-5   a startle/recoil with comic zigzag marks
    ///   sheet-10_24_14-1   mouth open on frame 4 (reaction)
    ///   sheet-10_24_14-2   mouth open on frame 4 (reaction)
    ///   sheet-10_24_15-9   mouth open on frames 2-4 (a yawn)
    ///   sheet-10_24_15-6   a blank grey slab the animal climbs and touches (a prop)
    ///   sheet-10_24_15-7   a blank grey post the animal leans on and touches (a prop)
    ///   sheet-10_23_57-7   the food bowl  -- used as the EAT clip, not as an idle
    ///   sheet-10_23_57-8   the water bowl -- used as the DRINK clip, not as an idle
    ///   sheet-10_23_57-9   a drowsy head-down doze
    ///   sheet-10_23_57-10  the curl sequence -- used as the CURL clip
    var walkClipNames: [String] {
        ["sheet-10_23_56-1", "sheet-10_23_56-2", "sheet-10_23_57-5", "sheet-10_23_57-6",
         "sheet-10_24_15-3", "sheet-10_24_15-4", "sheet-10_24_15-8"].filter {
            porcClips[$0] != nil
        }
    }

    /// The curl. sheet-10_23_57-10 is a genuine curl-into-a-ball: frame 0 stands, 1-3 lower
    /// the head, 4-5 spread the quills into a round ball, 6 holds the ball, 7 starts to
    /// unfurl. (The app used to call this clip 03, because clip 03 *is* sheet (10) -- the
    /// number was just misread as a different sheet.)
    var curlClipName: String? { porcClips["sheet-10_23_57-10"] != nil ? "sheet-10_23_57-10" : nil }

    /// Eating. sheet-10_23_57-7 is the only sheet with a bowl of FOOD: a blue bowl with
    /// brown food arrives at frame 1, and frames 3-5 put the snout down in the bowl with the
    /// eyes closed. (The old eat clip 08 was sheet 10_23_57-7 too, via the same off-by-ten.)
    var eatClipName: String? { porcClips["sheet-10_23_57-7"] != nil ? "sheet-10_23_57-7" : nil }

    /// Picked up: the sheet that leans back and squirms with its paws up. The user
    /// identified this one; it had been filed as a "startle, avoid" reaction, which was
    /// right for the walk and wrong for being grabbed.
    var pickupClipName: String? { porcClips["pickup"] != nil ? "pickup" : nil }

    /// Drinking from the water bowl, sheet-10_23_57-8 (a grey bowl of blue water; frames
    /// 3-6 put the head down in it). Kept so a snack can pick food or water.
    var drinkClipName: String? { porcClips["sheet-10_23_57-8"] != nil ? "sheet-10_23_57-8" : nil }

    /// The walk cycle proper: porc/walk/, cut by build-walker.py from the ONE sheet whose
    /// legs genuinely articulate -- sheet-10_23_57-3, the sheet the user identified. Its 8
    /// frames are REAL frames in the sheet's own order, no synthesis of any kind: measured
    /// on the finished clip the front paw sweeps 180.5 -> 251.6 art px and the paw span
    /// alternates spread (205-209) / together (8-18), i.e. four steps per cycle. The old
    /// porc/walk was built by shearing the leg region to fake the swing; that clip is
    /// preserved at porc.bak-before-walk/walk-sheared-DELETEME and is NOT used.
    var walkCycleName: String? { porcClips["walk"] != nil ? "walk" : nil }

    /// Frames per second for the walk cycle, and the ground speed that goes with it so the
    /// feet do not slide. Measured on the REAL porc/walk (sheet-10_23_57-3, one canvas,
    /// body width 329 art px = the app's 78 pt target, so 78/329 = 0.2371 pt per art px):
    ///
    ///   per step the planted front paw travels 56.4 art px relative to the body
    ///   (frame pairs contact->passing: 48.7, 64.1, 66.5, 43.0; median 56.4)
    ///   stride per step = 56.4 x 0.2371 = 13.37 pt
    ///   the cycle is 8 frames = FOUR steps, so one cycle advances 4 x 13.37 = 53.49 pt
    ///   at 8 fps the cycle takes 1.0 s, so the matching ground speed is 53.49 pt/s.
    /// Change one of these and the other must move with it, or the pet slides.
    func walkFPS() -> Double { 8.0 }
    /// Ground speed, re-derived whenever the drawn size changes, because the stride scales
    /// with it. Measured from the walk clip: the planted front paw travels 56.4 art px per
    /// step, body width is 329 art px, so at the 104 pt drawn width one step is
    /// 56.4 * (104/329) = 17.83 pt, a 4-step cycle is 71.3 pt, and at 8 fps (1.0 s per
    /// cycle) the matching speed is 71.3 pt/s. Feet do not slide.
    func walkSpeedPtPerSec() -> CGFloat {
        // Ground speed, so the feet do not slide. Measured on the walk clip: the planted
        // front paw travels 56.4 art px per step over a 329 px body, and the cycle is 8
        // frames containing 4 steps.
        //
        //   stridePt        = 56.4 * (drawn width / 329)
        //   cycleDistancePt = stridePt * 4
        //   cycleSeconds    = frames / fps
        //   speed           = cycleDistancePt / cycleSeconds
        //
        // The earlier version multiplied by fps instead of dividing by the cycle duration,
        // which at Medium worked out to 570 pt/s: the pet dashed to its target and stopped,
        // which is what read on screen as popping out of nowhere.
        let frames = Double(porcClips[walkCycleName ?? ""]?.frames.count ?? 8)
        guard frames > 0, walkFPS() > 0 else { return 0 }
        let stridePt = 56.4 * (walkerWidthPt() / 329.0)
        let cycleDistancePt = stridePt * 4.0
        let cycleSeconds = frames / walkFPS()
        return cycleDistancePt / CGFloat(cycleSeconds)
    }

    /// On-screen BODY WIDTH for the walking pet, in points. A hedgehog beside a macaw is a
    /// small animal, and at this size the quills and legs read without dominating.
    /// Drawn body width for the walking pets, in points. Small / Medium / Large come from
    /// the same right-click menu the macaw uses, and persist across launches.
    var walkerSize: CGFloat = 104
    func walkerWidthPt() -> CGFloat { walkerSize }

    /// The three walker sizes, matching the menu's Small / Medium / Large order.
    static let walkerSizes: [CGFloat] = [72, 104, 144]

    func saveWalkerSize() {
        try? String(Int(walkerSize)).write(toFile: kPetHome + "/pet-size.txt",
                                           atomically: true, encoding: .utf8)
    }

    func loadWalkerSize() {
        if let raw = try? String(contentsOfFile: kPetHome + "/pet-size.txt", encoding: .utf8),
           let v = Double(raw.trimmingCharacters(in: .whitespacesAndNewlines)), v >= 40, v <= 220 {
            walkerSize = CGFloat(v)
        }
    }

    /// On-screen height for the walking pet, in points. Smaller than the macaw, because a
    /// hedgehog beside a macaw is a small animal, but big enough to read as a character.
    func walkerHeightPt() -> CGFloat { 66 }

    func walkerScale() -> CGFloat {
        guard let hg = hedgehog, hg.size.height > 0 else { return 1 }
        return walkerHeightPt() / hg.size.height
    }

    /// Walks the bottom of the screen: choose a spot, waddle to it, sit, repeat. The art is
    /// one still pose, so the walk is a bob plus a tilt rather than a frame cycle, and the
    /// sprite is mirrored for travel in the other direction.
    func tickWalker(_ dt: Double, _ screen: NSRect) {
        if species == .porcupine, !porcClips.isEmpty { tickPorcupine(dt, screen); return }
        guard let hg = hedgehog, !hg.frames.isEmpty else { return }
        let s = walkerScale()
        let w = hg.size.width * s, h = hg.size.height * s
        let groundY = screen.minY + 6
        let span = max(1, screen.width - w)
        if walkTargetX == 0 { walkTargetX = CGFloat.random(in: screen.minX ... screen.minX + span) }

        if walkRestLeft > 0 {
            walkRestLeft -= dt
            waddle *= 0.86                                   // settle to still
            if walkRestLeft <= 0 {
                walkTargetX = CGFloat.random(in: screen.minX ... screen.minX + span)
                if Bool.random() { facingLeft.toggle() }      // sometimes just turns around
            }
        } else {
            let dx = walkTargetX - pos.x
            if abs(dx) < 8 {
                walkRestLeft = Double.random(in: 1.5 ... 5.0)
            } else {
                let dir: CGFloat = dx > 0 ? 1 : -1
                pos.x += dir * 46 * dt                        // a hedgehog's pace, exaggerated
                facingLeft = dir < 0
                waddle += dt * 6.5
            }
        }
        pos.x = min(max(pos.x, screen.minX + w / 2), screen.minX + span + w / 2)

        let resting = walkRestLeft > 0
        let bob = resting ? 0 : abs(sin(waddle)) * 1.7
        let tilt = resting ? 0 : sin(waddle) * 1.8

        let origin = CGPoint(x: pos.x - w / 2, y: groundY + bob)
        window.setFrame(NSRect(x: origin.x, y: origin.y, width: w, height: h), display: false)
        view.frame = NSRect(origin: .zero, size: NSSize(width: w, height: h))
        view.image = hg.frames[0]
        view.imageRect = NSRect(x: 0, y: 0, width: w, height: h)
        view.mask = hg.masks[0]
        view.flipX = !facingLeft
        view.rotation = tilt
        view.needsDisplay = true
    }

    /// The porcupine: walks on the real cycle cut from sheet-10_23_57-3, curls into a ball
    /// from sheet-10_23_57-10, and eats from the food bowl in sheet-10_23_57-7. The IDLE
    /// rotates a source-sheet clip every couple of seconds (those sheets are near-identical
    /// standing poses, which is exactly the variety an idle wants).
    func nearestCornerX(_ screen: NSRect, _ w: CGFloat) -> CGFloat {
        let left = screen.minX + w / 2, right = screen.minX + max(1, screen.width - w) + w / 2
        return abs(pos.x - left) < abs(pos.x - right) ? left : right
    }

    func tickPorcupine(_ dt: Double, _ screen: NSRect) {
        // Picked up: squirm in place, do not walk, and leave the window where the drag put it.
        if beingHeld {
            if !pickupLogged {
                pickupLogged = true
                speakLog("pickup branch: clip=\(pickupClipName ?? "nil") found=\(porcClips[pickupClipName ?? ""] != nil)")
            }
            if let pick = pickupClipName, let pc = porcClips[pick] {
                heldClock += dt
                if heldLeft > 0 {
                    heldLeft -= dt
                    if heldLeft <= 0 { beingHeld = false; pickupLogged = false }   // test hold expires
                }
                let sc = pc.scale(forBodyWidth: walkerWidthPt())
                let w = pc.size.width * sc, h = pc.size.height * sc
                view.imageRect = NSRect(x: 0, y: 0, width: w, height: h)
                let fi = Int(heldClock * 7.0) % max(1, pc.frames.count)
                view.image = pc.frames[fi]
                view.mask = pc.masks[fi % max(1, pc.masks.count)]
                view.flipX = (pc.artFacesLeft == facingLeft) ? false : true
                view.rotation = 0
                view.needsDisplay = true
                return
            }
        }
        // The walk uses the cycle clip; the IDLE uses the varied source clips. While the pet
        // is moving the cycle is forced (its frames are one ordered walk). While it is RESTING
        // a different source sheet is drawn now and then: many sheets are near-identical
        // walking poses, so that is where the idle variety actually lives, and it stops the
        // idle from looping the same eight cycle frames forever.
        let resting = walkRestLeft > 0 && curlLeft <= 0 && eatLeft2 <= 0
        if resting {
            idleTick += dt
            if idleTick > 2.2 {
                idleTick = 0
                if let pick = walkClipNames.randomElement() { walkClipName = pick }
            }
        } else {
            idleTick = 0
            if curlLeft <= 0 && eatLeft2 <= 0, let cyc = walkCycleName { walkClipName = cyc }
        }
        let clipName: String
        if curlLeft > 0 {
            if !curlLogged { curlLogged = true; speakLog("curl branch: clip=\(curlClipName ?? "walk") frames=\(porcClips[curlClipName ?? ""]?.frames.count ?? -1)") }
            curlLeft -= dt
            clipName = curlClipName ?? walkClipName
        } else if eatLeft2 > 0 {
            curlLogged = false
            eatLeft2 -= dt
            clipName = eatClipName ?? walkClipName
        } else {
            curlLogged = false
            clipName = walkClipName
        }
        if curlLeft > 0 {
            curlTicks += 1
            if curlTicks % 5 == 0 {
                speakLog("curl tick: clip=\(clipName) frame=\(walkFrame)/\(porcClips[clipName]?.frames.count ?? -1) curlLeft=\(String(format: "%.2f", curlLeft))")
            }
        } else { curlTicks = 0 }
        guard let clip = porcClips[clipName], !clip.frames.isEmpty else {
            if !walkerMissLogged {
                walkerMissLogged = true
                speakLog("walker: clip '\(clipName)' not found among \(porcClips.count) clips -> drawing nothing (stale image may persist)")
            }
            return
        }
        let s = clip.scale(forBodyWidth: walkerWidthPt())
        let w = clip.size.width * s, h = clip.size.height * s
        let groundY = screen.minY + 6
        let span = max(1, screen.width - w)
        if walkTargetX == 0 { walkTargetX = CGFloat.random(in: screen.minX ... screen.minX + span) }

        // The walk cycle runs on its own clock at the measured fps; an idle sheet breathes at
        // the slower rate, because those frames are near-identical poses, not a cycle.
        if curlLeft <= 0 && eatLeft2 <= 0 {
            walkClock += dt
            if let cyc = walkCycleName, clipName == cyc {
                walkFrame = Int(walkClock * walkFPS()) % max(1, clip.frames.count)
            } else {
                walkFrame = Int(walkClock * 5.0) % max(1, clip.frames.count)
            }
        } else {
            // play in, then hold the last frame for as long as the state lasts. The play-in
            // time is fixed (2.2 s for the curl, 1.6 s for the meal) so a long hold does not
            // stretch the animation itself.
            let playIn = curlLeft > 0 ? 2.2 : 1.6
            let elapsed = curlLeft > 0 ? (curlTotal - curlLeft) : (eatTotal - eatLeft2)
            walkFrame = min(clip.frames.count - 1,
                            Int(max(0, elapsed) / playIn * CGFloat(clip.frames.count)))
        }

        // the rest ritual runs before the plain wander logic
        switch ritual {
        case .toCorner:
            if abs(walkTargetX - pos.x) < 10 {
                curlTotal = Double.random(in: 12 ... 20)
                curlLeft = curlTotal
                ritual = .curlHold
            }
        case .curlHold:
            if curlLeft <= 0 { eatTotal = Double.random(in: 4 ... 6); eatLeft2 = eatTotal; ritual = .eat }
        case .eat:
            if eatLeft2 <= 0 {
                ritual = .none
                walkTargetX = CGFloat.random(in: screen.minX ... screen.minX + span)
            }
        case .none:
            break
        }

        if ritual != .none {
            // walking to the corner only; otherwise stand and let the curl/eat play
            if ritual == .toCorner {
                let dx = walkTargetX - pos.x
                let dir: CGFloat = dx > 0 ? 1 : -1
                pos.x += dir * walkSpeedPtPerSec() * dt
                facingLeft = dir < 0
                waddle += dt * walkFPS() / 8.0
            } else {
                waddle *= 0.86
            }
        } else if walkRestLeft > 0 {
            walkRestLeft -= dt
            waddle *= 0.86
            if walkRestLeft <= 0 {
                walkTargetX = CGFloat.random(in: screen.minX ... screen.minX + span)
                if Bool.random() { facingLeft.toggle() }
            }
        } else if curlLeft <= 0 && eatLeft2 <= 0 {
            let dx = walkTargetX - pos.x
            if abs(dx) < 8 {
                walkRestLeft = Double.random(in: 1.2 ... 3.5)
            } else {
                let dir: CGFloat = dx > 0 ? 1 : -1
                pos.x += dir * walkSpeedPtPerSec() * dt   // matched to the stride, no sliding
                facingLeft = dir < 0
                waddle += dt * 5.0
            }
        }
        pos.x = min(max(pos.x, screen.minX + w / 2), screen.minX + span + w / 2)

        let moving = walkRestLeft <= 0 && curlLeft <= 0 && eatLeft2 <= 0
        // When the real walk cycle plays, its frames already carry the step, so the fake
        // bob/tilt would fight it: drop the tilt and keep only a token bob. With the
        // fallback (a single still pose) the bob is what sells the walk.
        let onCycle = (walkCycleName != nil && clipName == walkCycleName)
        let bob = moving ? (onCycle ? abs(sin(Double(walkFrame) / Double(max(1, clip.frames.count)) * .pi)) * 0.7
                                    : abs(sin(waddle)) * 0.7) : 0
        let tilt = (moving && !onCycle) ? sin(waddle) * 0.9 : 0

        let origin = CGPoint(x: pos.x - w / 2, y: groundY + bob)
        window.setFrame(NSRect(x: origin.x, y: origin.y, width: w, height: h), display: false)
        view.frame = NSRect(origin: .zero, size: NSSize(width: w, height: h))
        view.image = clip.frames[min(walkFrame, clip.frames.count - 1)]
        view.imageRect = NSRect(x: 0, y: 0, width: w, height: h)
        view.mask = clip.masks[min(walkFrame, clip.masks.count - 1)]
        // artFacesLeft == true means the sprite already points left, so it is drawn as-is
        // when travelling left and mirrored when travelling right. Getting this backwards is
        // the moonwalk.
        view.flipX = (clip.artFacesLeft == facingLeft) ? false : true
        view.rotation = tilt
        view.needsDisplay = true
    }

    /// Draw the walking pet without touching the window geometry, for use while the think
    /// box is open and the window has been grown into a stage.
    func drawWalkerInPlace(_ dt: Double, _ screen: NSRect) {
        let clipName: String
        if curlLeft > 0 { clipName = curlClipName ?? walkClipName }
        else if eatLeft2 > 0 { clipName = eatClipName ?? walkClipName }
        else { clipName = walkClipName }
        guard let clip = porcClips[clipName], !clip.frames.isEmpty else { return }
        boxClock += dt
        let s = clip.scale(forBodyWidth: walkerWidthPt())
        let w = clip.size.width * s, h = clip.size.height * s
        view.imageRect = NSRect(x: 8, y: 8, width: w, height: h)
        let fi = Int(boxClock * walkFPS()) % max(1, clip.frames.count)
        view.image = clip.frames[fi]
        view.mask = clip.masks[fi % max(1, clip.masks.count)]
        view.flipX = (clip.artFacesLeft == facingLeft) ? false : true
        view.rotation = 0
    }

    // MARK: - motion

    func pickTarget(_ screen: NSRect) {
        let size = idleSize()
        target = CGPoint(x: CGFloat.random(in: screen.minX ... max(screen.minX, screen.maxX - size.width)),
                         y: CGFloat.random(in: screen.minY ... max(screen.minY, screen.maxY - size.height)))
    }

    func moveTo(_ origin: CGPoint) {
        pos = clampOrigin(origin, window.frame.size)
        target = origin
        resting = true
        restTimer = max(restTimer, 1.2)
        window.setFrameOrigin(NSPoint(x: pos.x, y: pos.y))
    }

    /// The bird's own rectangle inside the window, in window coordinates (points).
    /// y is flipped here: art rows count downward, view coordinates count upward.
    func inkRectInWindow(_ boxes: [CGRect], _ artSize: CGSize, _ index: Int, _ scale: CGFloat) -> CGRect {
        guard index < boxes.count else {
            return CGRect(origin: .zero, size: window.frame.size)
        }
        let b = boxes[index]
        let artH = artSize.height
        let s = scale
        let yTop = (artH - b.maxY) * s
        return CGRect(x: b.minX * s, y: yTop, width: b.width * s, height: b.height * s)
    }

    /// Slide an origin so the visible bird just touches the screen edges. The empty
    /// sprite margin is allowed to hang off the display; the parrot is not.
    func clampOnInk(_ origin: CGPoint, boxes: [CGRect], artSize: CGSize, index: Int,
                    scale: CGFloat, size: NSSize) -> CGPoint {
        let f = screenFor(NSRect(origin: origin, size: size)).visibleFrame
        let ink = inkRectInWindow(boxes, artSize, index, scale)
        let minX = f.minX - ink.minX
        let maxX = f.maxX - ink.maxX
        let minY = f.minY - ink.minY
        let maxY = f.maxY - ink.maxY
        return CGPoint(x: min(max(origin.x, minX), max(minX, maxX)),
                       y: min(max(origin.y, minY), max(minY, maxY)))
    }

    /// Belt and braces: whatever a phase computed, the window ends up on screen.
    func settleWindow() {
        let f = window.frame
        let clamped = clampOrigin(f.origin, f.size)
        if clamped != f.origin { window.setFrameOrigin(NSPoint(x: clamped.x, y: clamped.y)) }
    }

    /// How far the visible bird currently is from each screen edge, for verification.
    func inkMargins() -> (CGFloat, CGFloat, CGFloat, CGFloat) {
        let f = screenFor(window.frame).visibleFrame
        let win = window.frame
        let isRest = phase == .resting
        if isRest {
            guard stepIdx < seq.count, let c = clips[seq[stepIdx].clip] else { return (0, 0, 0, 0) }
            let ink = inkRectInWindow(c.inkBBoxes, c.size, seq[stepIdx].from,
                                      c.scale(forBirdHeight: flyingBirdHeightPt()))
            let l = win.minX + ink.minX - f.minX
            let r = f.maxX - (win.minX + ink.maxX)
            let b = win.minY + ink.minY - f.minY
            let t = f.maxY - (win.minY + ink.maxY)
            return (l, r, b, t)
        }
        let idx = frameIndex % max(1, sprite.frames.count)
        let scale = (kBirdSlot * unit) / max(1, sprite.size.width)
        let ink = inkRectInWindow(sprite.inkBBoxes, sprite.size, idx, scale)
        let l = win.minX + ink.minX - f.minX
        let r = f.maxX - (win.minX + ink.maxX)
        let b = win.minY + ink.minY - f.minY
        let t = f.maxY - (win.minY + ink.maxY)
        return (l, r, b, t)
    }

    func tick() {
        let now = Date()
        let dt = min(0.05, now.timeIntervalSince(lastTick))
        lastTick = now
        let screen = screenFrame()

        // sprite clock runs in every phase: wings beat while flying, heads dip while eating
        let rate = kFPS * (1.0 + burst * 1.6)
        burst = max(0, burst - dt * 1.2)

        if speaking {
            speakLeft -= dt
            refreshAccum += dt
            if folding {
                view.boxAlpha = max(0, view.boxAlpha - dt * 2.6)
                if view.boxAlpha <= 0.02 {
                    speakLog("finishFold")
                    finishFold()
                }
            } else {
                view.boxAlpha = min(1, view.boxAlpha + dt * 4.0)
                if refreshAccum > kRefreshSeconds { refreshAccum = 0; refreshRows() }
                if speakLeft <= 0 { fold() }
            }
            if species == .macaw {
                if phase == .flying {
                    frameClock += dt * rate
                    if frameClock >= 1 { frameClock -= 1; frameIndex += 1 }
                    setFlightFrame(resizeWindow: false)
                }
            } else {
                // walkers: keep drawing their own clip so the pet stays a porcupine while it
                // talks, and do NOT re-lay the window or the speaking stage would shrink and
                // clip the think box
                drawWalkerInPlace(dt, screen)
            }
            view.needsDisplay = true
            return
        }

        let frozen = FileManager.default.fileExists(
            atPath: kPetHome + "/motion-freeze")

        if species == .porcupine || species == .hedgehog {
            if speaking {
                speakLeft -= dt
                refreshAccum += dt
                if folding {
                    view.boxAlpha = max(0, view.boxAlpha - dt * 2.6)
                    if view.boxAlpha <= 0.02 { speakLog("finishFold"); finishFold() }
                } else {
                    view.boxAlpha = min(1, view.boxAlpha + dt * 4.0)
                    if refreshAccum > kRefreshSeconds { refreshAccum = 0; refreshRows() }
                    if speakLeft <= 0 { fold() }
                }
                drawWalkerInPlace(dt, screen)   // draws without touching the window, or the
                                                // speaking stage shrinks and clips the box
                view.needsDisplay = true
                return
            }
            if !frozen { tickWalker(dt, screen) }
            return
        }

        if phase == .flying {
            frameClock += dt * rate
            if frameClock >= 1 { frameClock -= 1; frameIndex += 1 }
            setFlightFrame()

            if !frozen {
                sinceRest += dt
                if sinceRest > nextRest, !clips.isEmpty {
                    beginRest(screen)
                } else if resting {
                    restTimer -= dt
                    if restTimer <= 0 { resting = false; pickTarget(screen) }
                } else {
                    let dx = target.x - pos.x, dy = target.y - pos.y
                    let dist = max(1, sqrt(dx * dx + dy * dy))
                    let speed = (140.0 + burst * 260.0) * dt
                    let step = min(1.0, speed / dist)
                    pos.x += dx * step
                    pos.y += dy * step + sin(now.timeIntervalSince1970 * 2.4) * 0.9
                    if dist < 12 {
                        resting = true
                        restTimer = Double.random(in: 1.5 ... 5.0)
                    }
                }
            }
            pos = clampOnInk(pos, boxes: sprite.inkBBoxes, artSize: sprite.size,
                             index: frameIndex % max(1, sprite.frames.count),
                             scale: (kBirdSlot * unit) / max(1, sprite.size.width), size: idleSize())
            window.setFrameOrigin(NSPoint(x: pos.x, y: pos.y))
            view.needsDisplay = true
            return
        }

        // ---- resting: fly in, then play the visit sequence
        restTimerClock += dt
        if restStage == 0 {
            let dx = target.x - pos.x, dy = target.y - pos.y
            let dist = max(1, sqrt(dx * dx + dy * dy))
            let step = min(1.0, (240.0 * dt) / dist)
            pos.x += dx * step
            pos.y += dy * step
            frameClock += dt * rate
            if frameClock >= 1 { frameClock -= 1; frameIndex += 1 }
            setFlightFrame(resizeWindow: false)
            pos = clampOnInk(pos, boxes: sprite.inkBBoxes, artSize: sprite.size,
                             index: frameIndex % max(1, sprite.frames.count),
                             scale: (kBirdSlot * unit) / max(1, sprite.size.width), size: idleSize())
            window.setFrameOrigin(NSPoint(x: pos.x, y: pos.y))
            view.needsDisplay = true
            if dist < 30 || frozen {
                // the perch is built where the bird actually is, so it does not hop
                let feetX = pos.x + (kBirdX + kBirdSlot * 0.50) * unit
                let feetY = pos.y + (kBirdY + kBirdSlot * 0.58) * unit
                let f = screenFor(NSRect(origin: pos, size: window.frame.size)).visibleFrame
                let ref = referenceClip
                let rs = ref?.scale(forBirdHeight: flyingBirdHeightPt()) ?? 1
                let rw = (ref?.size.width ?? 470) * rs
                let rh = (ref?.size.height ?? 787) * rs
                restAnchor = CGPoint(x: min(max(feetX, f.minX + rw * 0.35), f.maxX - rw * 0.35),
                                     y: min(max(feetY, f.minY + 60), f.maxY - rh * 0.45))
                seq = buildVisit()
                stepIdx = 0
                stepTime = 0
                restStage = 1
                restTimerClock = 0
            }
        } else {
            advanceStep(dt, screen)
        }
    }

    /// A visit: land, settle, sometimes eat, wind up, take off. Each step is a real clip
    /// with its own frame count and rate, chosen at random where several sheets show the
    /// same behaviour, so no two visits look identical.
    ///
    /// Registration: every clip used here has been re-registered by SHAPE (see
    /// shape-register.py) so the platform's bottom edge sits on the art anchor row
    /// (0.82*H) and its centre on the anchor column (0.5*W); size is normalised on
    /// sqrt(silhouette area) (fix-size.py) so the tail, which hangs below the plank, does
    /// not make one pose draw larger than another. Clips 16 (land) and 19 (take-off) were
    /// shifted by hand against the same anchor because their plank is grey and thin and
    /// colour cannot separate it from the bird -- the shape-based plank detector is used
    /// for the rest. Do NOT "simplify" this by colour-matching the plank; that tears the
    /// bird (the gold wing feathers sit inside the plank's RGB range).
    func buildVisit() -> [RestStep] {
        // Clip choice is evidence-based. Measuring the plank's position in every frame of
        // every clip shows two families:
        //   steady   plank bottom 640-648, centre 234-237 in EVERY frame: 04, 05, 06, 07,
        //            08, 10, 11, 12, 15, land-plank
        //   drifting 01 and 02, whose source art draws the plank somewhere different in
        //            each frame (clip 01's plank bottom walks 518 -> 710 across its frames).
        //            No rigid shift can register that, so they are not used as perches.
        // Using only the steady family means the perch cannot slide under the bird when
        // the behaviour changes clip.
        var steps: [RestStep] = []
        if clips["16"] != nil { steps.append(RestStep(clip: "16", from: 0, to: 7, fps: 6)) }   // land
        let idles = ["11", "04", "07", "10", "15"].filter { clips[$0] != nil }
        if let idle = idles.randomElement() {
            steps.append(RestStep(clip: idle, from: 0, to: 7, fps: 3,
                                  hold: Double.random(in: 3.5 ... 8.0)))                       // settle
        }
        // Eating: clip 05 is steady (646 / 235) and is one of the two sheets with a real
        // bowl. 17 draws the bowl as a white blank and 18 has no bowl at all.
        if Bool.random(), clips["05"] != nil {
            steps.append(RestStep(clip: "05", from: 0, to: 2, fps: 4))                         // bowl appears
            steps.append(RestStep(clip: "05", from: 3, to: 6, fps: 2.4,
                                  hold: Double.random(in: 4.0 ... 7.0)))                       // pecking
        }
        if clips["19"] != nil { steps.append(RestStep(clip: "19", from: 0, to: 7, fps: 7)) }   // take off
        return steps
    }

    func advanceStep(_ dt: Double, _ screen: NSRect) {
        guard stepIdx < seq.count else { finishRest(screen); return }
        let step = seq[stepIdx]
        guard let clip = clips[step.clip] else { stepIdx += 1; stepTime = 0; return }
        stepTime += dt
        let count = max(1, step.to - step.from + 1)
        let pass = Double(count) / step.fps
        let total = step.hold ?? pass
        let t = min(stepTime, total)
        var frame = step.from + Int(t * step.fps)
        if step.hold != nil { frame = step.from + (Int(t * step.fps) % count) }
        frame = min(max(frame, step.from), min(step.to, clip.frames.count - 1))
        setRestFrame(clip, frame, flip: restFlip)
        if stepTime >= total { stepIdx += 1; stepTime = 0 }
    }

    // MARK: - menu

    func showMenu(_ event: NSEvent) {
        let menu = NSMenu()
        menu.addItem(.separator())
        for (title, sp) in [("Pet: porcupine", Species.porcupine), ("Pet: macaw", Species.macaw)] {
            let it = NSMenuItem(title: title, action: #selector(setSpecies(_:)), keyEquivalent: "")
            it.target = self
            it.representedObject = sp.rawValue
            it.state = species == sp ? .on : .off
            menu.addItem(it)
        }
        menu.addItem(.separator())
        let dockItem = NSMenuItem(title: "Show in Dock", action: #selector(toggleDock), keyEquivalent: "")
        dockItem.target = self
        dockItem.state = inDock ? .on : .off
        menu.addItem(dockItem)
        menu.addItem(.separator())
        let speakItem = NSMenuItem(title: "Speak", action: #selector(speakNow), keyEquivalent: "")
        speakItem.target = self
        menu.addItem(speakItem)

        let restItem = NSMenuItem(title: species == .macaw ? "Go rest and eat" : "Curl up in a corner",
                                  action: #selector(restNow), keyEquivalent: "")
        restItem.target = self
        menu.addItem(restItem)

        let top = NSMenuItem(title: "Always on top", action: #selector(toggleLevel), keyEquivalent: "")
        top.target = self
        top.state = window.level == .floating ? .on : .off
        menu.addItem(top)

        let desktop = NSMenuItem(title: "Behind other windows", action: #selector(setDesktopLevel), keyEquivalent: "")
        desktop.target = self
        desktop.state = window.level == .normal ? .on : .off
        menu.addItem(desktop)

        menu.addItem(.separator())
        for (title, u) in [("Small", 2.0), ("Medium", 3.0), ("Large", 4.2)] {
            let it = NSMenuItem(title: title, action: #selector(setSize(_:)), keyEquivalent: "")
            it.target = self
            it.representedObject = u
            if species == .macaw {
                it.state = abs(unit - CGFloat(u)) < 0.01 ? .on : .off
            } else {
                let idx = abs(u - 2.0) < 0.01 ? 0 : (abs(u - 3.0) < 0.01 ? 1 : 2)
                it.state = abs(walkerSize - AppDelegate.walkerSizes[idx]) < 0.5 ? .on : .off
            }
            menu.addItem(it)
        }
        menu.addItem(.separator())
        let send = NSMenuItem(title: species == .macaw ? "Fly somewhere" : "Walk somewhere",
                              action: #selector(flySomewhere), keyEquivalent: "")
        send.target = self
        menu.addItem(send)
        let quit = NSMenuItem(title: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quit)
        NSMenu.popUpContextMenu(menu, with: event, for: view)
    }

    @objc func speakNow() { speak() }

    /// Switching species re-lays the window: the macaw gets its flight window back, the
    /// hedgehog drops to the ground and starts walking.
    @objc func setSpecies(_ item: NSMenuItem) {
        guard let raw = item.representedObject as? String, let sp = Species(rawValue: raw) else { return }
        species = sp
        saveSpecies(sp)
        let screen = screenFrame()
        if sp == .hedgehog || sp == .porcupine {
            phase = .flying
            walkRestLeft = 0
            curlLeft = 0
            eatLeft2 = 0
            walkTargetX = 0
            pos = CGPoint(x: screen.midX, y: screen.minY + 6)
            tickWalker(0, screen)
        } else {
            let size = idleSize()
            setFlightFrame()
            pos = CGPoint(x: screen.midX, y: screen.midY)
            window.setFrame(NSRect(origin: pos, size: size), display: true)
            view.frame = NSRect(origin: .zero, size: size)
            view.rotation = 0
            pickTarget(screen)
        }
        view.needsDisplay = true
    }

    /// A pet with a Dock icon: the badge carries the number of live sessions, which is
    /// the one piece of state worth glanceable. Accessory mode (no Dock presence) is a
    /// menu toggle for when an extra Dock entry is unwanted.
    @objc func toggleDock() {
        inDock.toggle()
        NSApp.setActivationPolicy(inDock ? .regular : .accessory)
        if inDock { updateBadge() } else { NSApp.dockTile.badgeLabel = nil; NSApp.dockTile.display() }
    }

    func updateBadge() {
        guard inDock else { return }
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let n = activeSessionCount()
            DispatchQueue.main.async {
                guard let self, self.inDock else { return }
                let label = n > 0 ? "\(n)" : nil
                if NSApp.dockTile.badgeLabel != label {
                    NSApp.dockTile.badgeLabel = label
                    NSApp.dockTile.display()
                }
                // record it, so whether the badge is being driven can be checked without
                // relying on a Dock that may be auto-hidden
                let note = "dock badge    : \(label ?? "(none)")  (app type: \(NSApp.activationPolicy() == .regular ? "regular" : "accessory"))\n"
                if let fh = FileHandle(forWritingAtPath: kPetHome + "/pet-badge.txt") {
                    fh.seekToEndOfFile(); fh.write(note.data(using: .utf8)!); try? fh.close()
                } else {
                    try? note.write(toFile: kPetHome + "/pet-badge.txt",
                                    atomically: true, encoding: .utf8)
                }
            }
        }
    }
    @objc func restNow() {
        let screen = screenFrame()
        if species != .macaw {
            ritual = .toCorner
            let c = porcClips[walkClipName]
            let w = (c?.size.width ?? 340) * (c?.scale(forBodyWidth: walkerWidthPt()) ?? 0.3)
            walkTargetX = nearestCornerX(screen, w)
            return
        }
        phase = .flying
        sinceRest = 0
        nextRest = 0
        beginRest(screen)
    }
    @objc func toggleLevel() { window.level = window.level == .floating ? .normal : .floating }
    @objc func setDesktopLevel() { window.level = .normal }

    @objc func setSize(_ item: NSMenuItem) {
        guard let u = item.representedObject as? Double else { return }
        let anchor = window.frame.origin
        if species != .macaw {
            // index into the walker sizes, so Small/Medium/Large actually does something
            let idx = abs(u - 2.0) < 0.01 ? 0 : (abs(u - 3.0) < 0.01 ? 1 : 2)
            walkerSize = AppDelegate.walkerSizes[idx]
            saveWalkerSize()
            walkTargetX = 0
            view.needsDisplay = true
            return
        }
        unit = CGFloat(u)
        view.unit = unit
        view.boxUnit = boxUnitFor(unit)
        if phase == .resting { restScaleAndRedraw() } else { setFlightFrame() }
        pos = window.frame.origin
        window.setFrameOrigin(NSPoint(x: anchor.x, y: anchor.y))
        view.needsDisplay = true
    }

    func restScaleAndRedraw() {
        // re-lay the current step at the new scale, keeping the plank anchored
        lastRestKey = ""
        if stepIdx < seq.count, let clip = clips[seq[stepIdx].clip] {
            setRestFrame(clip, seq[stepIdx].from, flip: restFlip, force: true)
        }
    }

    @objc func flySomewhere() {
        if species != .macaw {
            ritual = .none                       // wander off somewhere new
            walkRestLeft = 0
            walkTargetX = 0
            return
        }
        restTimer = 0
        resting = false
        burst = 1.0
        if phase == .resting { phase = .flying; setFlightFrame() }
        let screen = screenFrame()
        pickTarget(screen)
    }
}

let app = NSApplication.shared
// Regular, so the Dock icon and its session badge are visible; launch with `open -g`
// (or the -nap flag below) to avoid stealing focus on startup. The pet's own menu can
// switch back to accessory mode.
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
