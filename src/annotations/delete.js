
exports.deleteAnnotations = function (structure) {
	for (let pageIndex = 0; pageIndex < structure['/Root']['/Pages']['/Kids'].length; pageIndex++) {
		let rawPage = structure['/Root']['/Pages']['/Kids'][pageIndex];
		if (!rawPage['/Annots']) continue;

		rawPage['/Annots'] = rawPage['/Annots'].filter((annot) => {
			let type = annot['/Subtype'];
			if (['Text', 'Highlight', 'Underline'].includes(type)) {
				return false;
			}

			if (type === 'Square' && (
				typeof annot['/NM'] === 'string' && annot['/NM'].includes('Zotero-')
				|| annot['/Zotero:Key']
			)) {
				return false;
			}
			return true;
		});

		// Filter out popups that no longer have /Parent annotations
		rawPage['/Annots'].filter(annot => annot['/Subtype'] !== 'Popup'
			|| !rawPage['/Annots'].includes(annot['/Parent']));

		if (!rawPage['/Annots'].length) {
			delete rawPage['/Annots'];
		}
	}
};
