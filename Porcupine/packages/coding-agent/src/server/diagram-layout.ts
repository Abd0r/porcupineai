import type { VisualParameters } from "../core/tools/visualize.ts";

type DiagramObject = Extract<VisualParameters, { kind: "diagram" }>["objects"][number];

/** Pixel geometry at a readable font size. Never changes supplied world coordinates. */
export function layoutDiagram(objects: DiagramObject[], availableWidth: number, measure: (text: string) => number) {
	const lineHeight = 20;
	const wrap = (text: string, width: number) => {
		if (/\$|\\[([]/.test(text)) return text.split("\n");
		const lines: string[] = [];
		for (const paragraph of text.split("\n")) {
			let line = "";
			for (const word of paragraph.split(/\s+/)) {
				if (line && measure(`${line} ${word}`) > width) {
					lines.push(line);
					line = word;
				} else line = line ? `${line} ${word}` : word;
			}
			lines.push(line);
		}
		return lines;
	};
	let minX = Infinity,
		maxX = -Infinity,
		minY = Infinity,
		maxY = -Infinity,
		minimumScale = 24;
	for (const object of objects) {
		if ("from" in object) {
			minX = Math.min(minX, object.from[0], object.to[0]);
			maxX = Math.max(maxX, object.from[0], object.to[0]);
			minY = Math.min(minY, object.from[1], object.to[1]);
			maxY = Math.max(maxY, object.from[1], object.to[1]);
			continue;
		}
		const halfWidth = object.type === "rectangle" ? object.size[0] / 2 : object.type === "circle" ? object.radius : 0;
		const halfHeight =
			object.type === "rectangle" ? object.size[1] / 2 : object.type === "circle" ? object.radius : 0;
		minX = Math.min(minX, object.position[0] - halfWidth);
		maxX = Math.max(maxX, object.position[0] + halfWidth);
		minY = Math.min(minY, object.position[1] - halfHeight);
		maxY = Math.max(maxY, object.position[1] + halfHeight);
		if (object.type === "text" || !object.label) continue;
		// A circle's inscribed square leaves space between text and its boundary.
		const width = halfWidth * (object.type === "circle" ? 1.4 : 2);
		const height = halfHeight * (object.type === "circle" ? 1.4 : 2);
		let scale = minimumScale;
		while (
			scale < 160 &&
			(wrap(object.label, Math.max(20, width * scale - 20)).length * lineHeight + 16 > height * scale ||
				object.label.split(/\s+/).some((word) => measure(word) + 20 > width * scale))
		)
			scale *= 1.12;
		minimumScale = Math.max(minimumScale, Math.min(160, scale));
	}
	const scale = Math.max(minimumScale, Math.min(64, (Math.max(240, availableWidth) - 64) / Math.max(1, maxX - minX)));
	const point = (p: number[]) => ({ x: (p[0] - minX) * scale, y: (maxY - p[1]) * scale });
	const obstacles = objects.flatMap((object) => {
		if ("from" in object || object.type === "text") return [];
		const center = point(object.position);
		const width = (object.type === "rectangle" ? object.size[0] : object.radius * 2) * scale;
		const height = (object.type === "rectangle" ? object.size[1] : object.radius * 2) * scale;
		return [{ x: center.x - width / 2, y: center.y - height / 2, width, height }];
	});
	const labels: Array<{ text: string; x: number; y: number; width: number; height: number; kind: string }> = [];
	for (const object of objects) {
		const text = object.type === "text" ? object.text : object.label;
		if (!text) continue;
		let width = Math.min(240, Math.max(100, Math.sqrt(measure(text) * lineHeight * 5)));
		let center: { x: number; y: number };
		if ("from" in object) {
			const a = point(object.from),
				b = point(object.to);
			center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
		} else {
			center = point(object.position);
			if (object.type !== "text")
				width = Math.max(40, (object.type === "rectangle" ? object.size[0] : object.radius * 1.4) * scale - 20);
		}
		// Keep complete words, including a long single token, at their natural width.
		width = Math.max(width, ...text.split(/\s+/).map(measure));
		if (/\$|\\[([]/.test(text)) width = Math.max(width, measure(text));
		const lines = wrap(text, width),
			height = lines.length * lineHeight;
		if ("from" in object) {
			const a = point(object.from),
				b = point(object.to),
				length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
			let best = Infinity;
			for (const fraction of [0.5, 0.3, 0.7])
				for (const side of [-1, 1])
					for (const gap of [12, 32, 56, 88]) {
						const x = a.x + (b.x - a.x) * fraction - ((b.y - a.y) / length) * (height / 2 + gap) * side;
						const y = a.y + (b.y - a.y) * fraction + ((b.x - a.x) / length) * (height / 2 + gap) * side;
						let overlap = 0;
						for (const box of [
							...obstacles,
							...labels.map((label) => ({
								x: label.x - label.width / 2,
								y: label.y - label.height / 2,
								width: label.width,
								height: label.height,
							})),
						]) {
							overlap +=
								Math.max(
									0,
									Math.min(x + width / 2 + 6, box.x + box.width) - Math.max(x - width / 2 - 6, box.x),
								) *
								Math.max(
									0,
									Math.min(y + height / 2 + 6, box.y + box.height) - Math.max(y - height / 2 - 6, box.y),
								);
						}
						const score = overlap * 1000 + gap + Math.abs(fraction - 0.5) * length;
						if (score < best) {
							best = score;
							center = { x, y };
						}
					}
		}
		labels.push({
			text: lines.join("\n"),
			...center,
			width,
			height,
			kind: "from" in object ? "edge" : object.type === "text" ? "annotation" : "node",
		});
	}
	let left = 0,
		top = 0,
		right = (maxX - minX) * scale,
		bottom = (maxY - minY) * scale;
	for (const label of labels) {
		left = Math.min(left, label.x - label.width / 2);
		top = Math.min(top, label.y - label.height / 2);
		right = Math.max(right, label.x + label.width / 2);
		bottom = Math.max(bottom, label.y + label.height / 2);
	}
	const padding = 28;
	for (const label of labels) {
		label.x += padding - left;
		label.y += padding - top;
	}
	return {
		width: Math.ceil(right - left + padding * 2),
		height: Math.ceil(bottom - top + padding * 2),
		scale,
		originX: padding - left - minX * scale,
		originY: padding - top + maxY * scale,
		labels,
	};
}
