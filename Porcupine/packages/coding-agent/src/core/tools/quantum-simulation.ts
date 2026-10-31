/** Crank–Nicolson evolution of a Gaussian packet, real static potential, zero endpoint boundaries. */
export function createQuantumSimulation(config: {
	domain: [number, number];
	grid: number;
	timeStep: number;
	mass: number;
	hbar: number;
	center: number;
	width: number;
	momentum: number;
	potential: (x: number) => number;
}) {
	const { domain, grid, timeStep: dt, mass, hbar, center, width, momentum, potential } = config;
	if (
		!Number.isInteger(grid) ||
		grid < 64 ||
		grid > 256 ||
		!(domain[0] < domain[1]) ||
		domain.some((x) => !Number.isFinite(x) || Math.abs(x) > 20) ||
		!Number.isFinite(dt) ||
		dt < 0.0001 ||
		dt > 0.02 ||
		!Number.isFinite(mass) ||
		mass <= 0 ||
		!Number.isFinite(hbar) ||
		hbar <= 0 ||
		!Number.isFinite(width) ||
		width <= 0 ||
		![center, momentum].every(Number.isFinite)
	)
		throw new Error("Invalid quantum model bounds");
	const dx = (domain[1] - domain[0]) / (grid - 1),
		kinetic = (hbar * hbar) / (2 * mass * dx * dx),
		off = (-dt * kinetic) / (2 * hbar),
		count = grid - 2;
	const real = new Float64Array(grid),
		imag = new Float64Array(grid),
		diagonal = new Float64Array(count),
		cpR = new Float64Array(count),
		cpI = new Float64Array(count),
		inverseR = new Float64Array(count),
		inverseI = new Float64Array(count),
		rhsR = new Float64Array(count),
		rhsI = new Float64Array(count);
	for (let i = 0; i < count; i++) {
		const value = potential(domain[0] + (i + 1) * dx),
			d = (dt * (2 * kinetic + value)) / (2 * hbar);
		if (!Number.isFinite(d) || Math.abs(d) > 1e8 || !Number.isFinite(off) || Math.abs(off) > 1e8)
			throw new Error("Quantum coefficients need consistent scaled units");
		diagonal[i] = d;
		const ar = 1 + (i ? off * cpI[i - 1] : 0),
			ai = d - (i ? off * cpR[i - 1] : 0),
			denom = ar * ar + ai * ai;
		inverseR[i] = ar / denom;
		inverseI[i] = -ai / denom;
		cpR[i] = -off * inverseI[i];
		cpI[i] = off * inverseR[i];
	}
	function reset() {
		let norm = 0;
		for (let j = 1; j < grid - 1; j++) {
			const x = domain[0] + j * dx,
				envelope = Math.exp(-(((x - center) / width) ** 2) / 4),
				angle = (momentum * x) / hbar;
			real[j] = envelope * Math.cos(angle);
			imag[j] = envelope * Math.sin(angle);
			norm += envelope * envelope * dx;
		}
		if (!Number.isFinite(norm) || norm < 1e-100) throw new Error("Wave packet is outside the simulation domain");
		for (let j = 1; j < grid - 1; j++) {
			real[j] /= Math.sqrt(norm);
			imag[j] /= Math.sqrt(norm);
		}
	}
	reset();
	let steps = 0;
	return {
		advance(time: number) {
			if (!Number.isFinite(time) || time < 0 || Math.ceil(time / dt) > 4000)
				throw new Error("Quantum evolution exceeds 4000 time steps");
			const target = Math.round(time / dt);
			if (target < steps) {
				reset();
				steps = 0;
			}
			while (steps < target) {
				for (let i = 0; i < count; i++) {
					const j = i + 1,
						d = diagonal[i];
					let r = real[j] + d * imag[j] + off * (imag[j - 1] + imag[j + 1]),
						im = imag[j] - d * real[j] - off * (real[j - 1] + real[j + 1]);
					if (i) {
						r += off * rhsI[i - 1];
						im -= off * rhsR[i - 1];
					}
					rhsR[i] = r * inverseR[i] - im * inverseI[i];
					rhsI[i] = r * inverseI[i] + im * inverseR[i];
				}
				for (let i = count - 1; i >= 0; i--) {
					const j = i + 1;
					real[j] = rhsR[i] - cpR[i] * real[j + 1] + cpI[i] * imag[j + 1];
					imag[j] = rhsI[i] - cpR[i] * imag[j + 1] - cpI[i] * real[j + 1];
				}
				steps++;
			}
		},
		sample: () => Array.from({ length: grid }, (_, i) => [domain[0] + i * dx, real[i] * real[i] + imag[i] * imag[i]]),
	};
}
