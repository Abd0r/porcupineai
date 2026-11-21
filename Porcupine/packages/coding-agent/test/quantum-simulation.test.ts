import { describe, expect, it } from "vitest";
import { createQuantumSimulation } from "../src/core/tools/quantum-simulation.ts";

describe("one-dimensional Schrodinger evolution", () => {
	it("moves a free packet with the expected momentum velocity", () => {
		const wave = createQuantumSimulation({
			domain: [-10, 10],
			grid: 256,
			timeStep: 0.005,
			mass: 1,
			hbar: 1,
			center: -2,
			width: 0.7,
			momentum: 1,
			potential: () => 0,
		});
		wave.advance(1);
		const dx = 20 / 255;
		expect(wave.sample().reduce((sum, p) => sum + p[0] * p[1] * dx, 0)).toBeCloseTo(-1, 2);
	});
	it("conserves probability while a free wave packet spreads", () => {
		const wave = createQuantumSimulation({
			domain: [-10, 10],
			grid: 256,
			timeStep: 0.01,
			mass: 1,
			hbar: 1,
			center: 0,
			width: 0.5,
			momentum: 0,
			potential: () => 0,
		});
		const before = wave.sample();
		wave.advance(1);
		const after = wave.sample(),
			dx = 20 / 255;
		expect(after.reduce((sum, p) => sum + p[1] * dx, 0)).toBeCloseTo(1, 9);
		expect(after[128][1]).toBeLessThan(before[128][1]);
		expect(after.every((p) => p.every(Number.isFinite))).toBe(true);
		wave.advance(0);
		expect(wave.sample()[128][1]).toBeCloseTo(before[128][1], 12);
	});
	it("keeps a packet centered in a symmetric harmonic potential", () => {
		const wave = createQuantumSimulation({
			domain: [-8, 8],
			grid: 128,
			timeStep: 0.01,
			mass: 1,
			hbar: 1,
			center: 0,
			width: Math.SQRT1_2,
			momentum: 0,
			potential: (x) => (x * x) / 2,
		});
		wave.advance(2);
		const samples = wave.sample(),
			dx = 16 / 127;
		expect(samples.reduce((sum, p) => sum + p[0] * p[1] * dx, 0)).toBeCloseTo(0, 9);
		expect(samples.reduce((sum, p) => sum + p[1] * dx, 0)).toBeCloseTo(1, 9);
	});
});
