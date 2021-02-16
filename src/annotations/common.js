const Util = require('../../pdf.js/build/lib/shared/util');

function getBoundingBox(box) {
	if (Array.isArray(box) && box.length === 4) {
		if (box[2] - box[0] !== 0 && box[3] - box[1] !== 0) {
			return box;
		}
	}
	return null;
}

function getRawPageView(rawPage) {
	const LETTER_SIZE_MEDIABOX = [0, 0, 612, 792];
	let mediaBox = rawPage['/MediaBox'] || LETTER_SIZE_MEDIABOX;
	let cropBox = rawPage['/CropBox'] || mediaBox;

	// From the spec, 6th ed., p.963:
	// "The crop, bleed, trim, and art boxes should not ordinarily
	// extend beyond the boundaries of the media box. If they do, they are
	// effectively reduced to their intersection with the media box."

	let view;
	if (cropBox === mediaBox || Util.isArrayEqual(cropBox, mediaBox)) {
		view = mediaBox;
	}
	else {
		const box = Util.intersect(cropBox, mediaBox);
		if (box && box[2] - box[0] !== 0 && box[3] - box[1] !== 0) {
			view = box;
		}
	}
	return view || mediaBox;
}

module.exports = {
	getRawPageView
};
