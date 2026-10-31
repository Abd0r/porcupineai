/** Fresh copies are passed to KaTeX so message-defined macros cannot leak to other messages. */
export const WORKBENCH_MATH_MACROS: Record<string, string> = {
	"\\bra": "\\left\\langle #1\\right|",
	"\\ket": "\\left|#1\\right\\rangle",
	"\\braket": "\\left\\langle #1\\middle|#2\\right\\rangle",
	"\\ketbra": "\\left|#1\\right\\rangle\\!\\left\\langle #2\\right|",
	"\\dv": "\\frac{\\mathrm{d}#1}{\\mathrm{d}#2}",
	"\\pdv": "\\frac{\\partial #1}{\\partial #2}",
	"\\abs": "\\left|#1\\right|",
	"\\norm": "\\left\\lVert #1\\right\\rVert",
};
