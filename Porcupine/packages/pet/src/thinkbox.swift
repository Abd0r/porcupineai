import AppKit
import CoreGraphics

// ThinkBox: the pet's pixel status bubble, drawn live in the app.
//
// The font and the pixel-text renderer are lifted from the preview tool so the pet
// and the previews cannot drift apart. The box is composed on every refresh, so it
// shows real session state instead of a stamped image.

let pixelFont: [Character: [String]] = [
    " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
    "~": [".....", ".....", ".#..#", "#.#.#", "#..#.", ".....", "....."],
    "|": ["..#..", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
    "&": [".##..", "#..#.", "#..##", ".##..", "#..#.", "#...#", ".####"],
    "\\": ["#....", ".#...", "..#..", "...#.", "...#.", "....#", "....."],
    "@": [".###.", "#...#", "#.###", "#.#.#", "#.###", "#....", ".###."],
    "$": ["..#..", ".####", "#.#..", ".###.", "..#.#", "####.", "..#.."],
    "^": ["..#..", ".#.#.", "#...#", ".....", ".....", ".....", "....."],
    "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
    "\"": [".#.#.", ".#.#.", ".....", ".....", ".....", ".....", "....."],
    "%": ["#...#", "...#.", "...#.", "..#..", ".#...", ".#...", "#...#"],
    "'": ["..#..", "..#..", ".....", ".....", ".....", ".....", "....."],
    "(": ["..#..", ".#...", "#....", "#....", "#....", ".#...", "..#.."],
    ")": ["..#..", "...#.", "....#", "....#", "....#", "...#.", "..#.."],
    "*": [".....", "#.#.#", ".###.", "#####", ".###.", "#.#.#", "....."],
    "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
    ",": [".....", ".....", ".....", ".....", ".##..", ".##..", ".#..."],
    "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
    ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
    "/": ["....#", "...#.", "...#.", "..#..", ".#...", ".#...", "#...."],
    "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
    "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
    "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
    "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
    "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
    "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
    "6": [".###.", "#...#", "#....", "####.", "#...#", "#...#", ".###."],
    "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
    "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
    "9": [".###.", "#...#", "#...#", ".####", "....#", "#...#", ".###."],
    ":": [".....", ".##..", ".##..", ".....", ".##..", ".##..", "....."],
    ";": [".....", ".##..", ".##..", ".....", ".##..", ".##..", ".#..."],
    "<": ["...#.", "..#..", ".#...", "#....", ".#...", "..#..", "...#."],
    "=": [".....", ".....", "#####", ".....", "#####", ".....", "....."],
    ">": [".#...", "..#..", "...#.", "....#", "...#.", "..#..", ".#..."],
    "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
    "A": [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "B": ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
    "C": [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
    "D": ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
    "E": ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
    "F": ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
    "G": [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
    "H": ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "I": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
    "J": ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
    "K": ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
    "L": ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
    "M": ["#...#", "##.##", "#.#.#", "#...#", "#...#", "#...#", "#...#"],
    "N": ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
    "O": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    "P": ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
    "Q": [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
    "R": ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
    "S": [".####", "#....", "#....", ".###.", "....#", "#...#", ".###."],
    "T": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
    "U": ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    "V": ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
    "W": ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
    "X": ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
    "Y": ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
    "Z": ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
    "_": [".....", ".....", ".....", ".....", ".....", ".....", "#####"],
    "a": [".....", ".....", ".###.", "....#", ".####", "#...#", ".####"],
    "b": ["#....", "#....", "####.", "#...#", "#...#", "#...#", "####."],
    "c": [".....", ".....", ".###.", "#...#", "#....", "#...#", ".###."],
    "d": ["....#", "#....", ".####", "#...#", "#...#", "#...#", ".####"],
    "e": [".....", ".....", ".###.", "#...#", "#####", "#....", ".###."],
    "f": ["..##.", ".#...", ".#...", "####.", ".#...", ".#...", ".#..."],
    "g": [".....", ".####", "#...#", "#...#", ".####", "....#", ".###."],
    "h": ["#....", "#....", "####.", "#...#", "#...#", "#...#", "#...#"],
    "i": ["..#..", ".....", ".##..", "..#..", "..#..", "..#..", ".###."],
    "j": ["...#.", ".....", "..##.", "...#.", "...#.", "#..#.", ".##.."],
    "k": ["#....", "#....", "#..#.", "#.#..", "##...", "#.#..", "#..#."],
    "l": [".##..", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
    "m": [".....", ".....", "##.#.", "#.#.#", "#.#.#", "#...#", "#...#"],
    "n": [".....", ".....", "####.", "#...#", "#...#", "#...#", "#...#"],
    "o": [".....", ".....", ".###.", "#...#", "#...#", "#...#", ".###."],
    "p": [".....", "####.", "#...#", "#...#", "####.", "#....", "#...."],
    "q": [".....", ".####", "#...#", "#...#", ".####", "....#", "....#"],
    "r": [".....", ".....", "#.##.", "##...", "#....", "#....", "#...."],
    "s": [".....", ".....", ".####", "#....", ".###.", "....#", "####."],
    "t": [".#...", ".#...", "####.", ".#...", ".#...", ".#..#", "..##."],
    "u": [".....", ".....", "#...#", "#...#", "#...#", "#...#", ".####"],
    "v": [".....", ".....", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
    "w": [".....", ".....", "#...#", "#...#", "#.#.#", "#.#.#", ".#.#."],
    "x": [".....", ".....", "#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
    "y": [".....", "#...#", "#...#", ".####", "....#", "#...#", ".###."],
    "z": [".....", ".....", "#####", "...#.", "..#..", ".#...", "#####"]
]

func drawPixelText(_ ctx: CGContext, _ text: String, x: CGFloat, y: CGFloat,
                   pixelSize: CGFloat, colour: CGColor, tracking: CGFloat = 1) {
    ctx.setFillColor(colour)
    var cx = x
    for ch in text {
        let rows = pixelFont[ch] ?? pixelFont[" "]!
        for (ry, row) in rows.enumerated() {
            for (rx, cell) in row.enumerated() where cell == "#" {
                ctx.fill(CGRect(x: cx + CGFloat(rx) * pixelSize,
                                y: y + CGFloat(6 - ry) * pixelSize,
                                width: pixelSize, height: pixelSize))
            }
        }
        cx += (5 + tracking) * pixelSize
    }
}

/// One row of the box: a label and its value.
struct BoxRow { var label: String; var value: String }

/// Ask the status feed for the current rows.
func fetchBoxRows() -> [BoxRow] {
    let task = Process()
    task.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
    let petHome = ProcessInfo.processInfo.environment["PORCUPINE_PET_HOME"]
        ?? (NSHomeDirectory() + "/wallpaper-lab/pet")
    task.arguments = [petHome + "/pet-status.py"]
    let pipe = Pipe(); task.standardOutput = pipe; task.standardError = Pipe()
    do { try task.run() } catch { return [] }
    task.waitUntilExit()
    let out = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    var rows: [BoxRow] = []
    for raw in out.split(separator: "\n") {
        let line = String(raw).trimmingCharacters(in: .whitespaces)
        guard !line.isEmpty, let bar = line.firstIndex(of: "|") else { continue }
        rows.append(BoxRow(label: String(line[line.startIndex..<bar]).trimmingCharacters(in: .whitespaces),
                           value: String(line[line.index(after: bar)...]).trimmingCharacters(in: .whitespaces)))
    }
    return rows
}

// Layout constants for the bubble, in logical units.
// Taller than it was (112): the feed grew a PET row, and a wrapped LAST PROMPT makes ten
// lines, which used to push MAIN off the bottom edge of the bubble.
let boxW: CGFloat = 246, boxH: CGFloat = 134
let boxLabelCol = 12
let boxBodyPx: CGFloat = 0.85
let boxTitlePx: CGFloat = 1.15

/// Draw the bubble and its tail at `origin`, scaled by `unit`.
func drawThinkBox(_ ctx: CGContext, origin: CGPoint, unit: CGFloat, rows: [BoxRow], alpha: CGFloat) {
    let ink = CGColor(red: 0.118, green: 0.129, blue: 0.157, alpha: 1)
    let cream = CGColor(red: 0.984, green: 0.953, blue: 0.894, alpha: 1)
    let gold = CGColor(red: 0.973, green: 0.722, blue: 0.0, alpha: 1)
    let dim = CGColor(red: 0.45, green: 0.47, blue: 0.5, alpha: 1)
    let u = unit
    ctx.setAlpha(alpha)
    ctx.setShouldAntialias(false)

    // tail: three circles shrinking toward the bird
    for (i, r) in [6.0, 4.0, 2.4].enumerated() {
        let cx = origin.x - (8.0 + Double(i) * 5.0) * u
        let cy = origin.y + (24.0 + Double(i) * 5.0) * u
        ctx.setFillColor(cream)
        ctx.fillEllipse(in: CGRect(x: cx - r * u, y: cy - r * u, width: 2 * r * u, height: 2 * r * u))
        ctx.setStrokeColor(ink)
        ctx.setLineWidth(u)
        ctx.strokeEllipse(in: CGRect(x: cx - r * u, y: cy - r * u, width: 2 * r * u, height: 2 * r * u))
    }

    let rect = CGRect(x: origin.x, y: origin.y, width: boxW * u, height: boxH * u)
    ctx.setFillColor(ink)
    ctx.fill(rect.insetBy(dx: -2 * u, dy: -2 * u))
    ctx.setFillColor(cream)
    ctx.fill(rect)
    let strip = CGRect(x: rect.minX, y: rect.maxY - 17 * u, width: rect.width, height: 17 * u)
    ctx.setFillColor(gold)
    ctx.fill(strip)
    ctx.setFillColor(ink)
    ctx.fill(CGRect(x: strip.minX, y: strip.minY - u, width: strip.width, height: u))

    drawPixelText(ctx, "PORCUPINE PET", x: rect.minX + 9 * u,
                  y: rect.maxY - 14 * u, pixelSize: boxTitlePx * u, colour: ink)

    let maxChars = Int((boxW - 18) / (6 * boxBodyPx))
    var ty = rect.maxY - 26 * u
    let lineStep = 9.5 * u
    var shown = 0
    for row in rows {
        if shown >= 12 { break }
        let label = row.label
        var value = row.value
        let budget = max(8, maxChars - max(boxLabelCol, label.count) - 1)
        let padded = label.padding(toLength: boxLabelCol, withPad: " ", startingAt: 0)
        let indent = String(repeating: " ", count: boxLabelCol + 1)
        if value.count > budget {
            var firstLine = "", secondLine = ""
            for w in value.split(separator: " ") {
                if firstLine.isEmpty || (firstLine.count + 1 + w.count) <= budget {
                    firstLine += (firstLine.isEmpty ? "" : " ") + w
                } else if secondLine.isEmpty || (secondLine.count + 1 + w.count) <= budget {
                    secondLine += (secondLine.isEmpty ? "" : " ") + w
                } else {
                    break
                }
            }
            if secondLine.count < value.count - firstLine.count - 1 {
                let cut = secondLine.prefix(max(1, budget - 3))
                secondLine = String(cut).trimmingCharacters(in: .whitespaces) + "..."
            }
            drawPixelText(ctx, padded + " " + firstLine, x: rect.minX + 9 * u, y: ty,
                          pixelSize: boxBodyPx * u, colour: ink)
            ty -= lineStep; shown += 1
            if !secondLine.isEmpty && shown < 12 {
                drawPixelText(ctx, indent + secondLine, x: rect.minX + 9 * u, y: ty,
                              pixelSize: boxBodyPx * u, colour: dim)
                ty -= lineStep; shown += 1
            }
            continue
        }
        if label.hasPrefix("STATUS") {
            ctx.setFillColor(CGColor(red: 0.30, green: 0.78, blue: 0.35, alpha: 1))
            ctx.fill(CGRect(x: rect.minX + 4 * u, y: ty, width: 2.6 * u, height: 2.6 * u))
        }
        drawPixelText(ctx, padded + " " + value, x: rect.minX + 9 * u, y: ty,
                      pixelSize: boxBodyPx * u, colour: ink)
        ty -= lineStep
        shown += 1
    }
    ctx.setAlpha(1)
}
