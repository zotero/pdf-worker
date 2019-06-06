
const fs = require('fs');
const pdfWorker = require('../../build/pdf-worker');

async function main() {
	let buf = fs.readFileSync('../example.pdf');
	let annotations = await pdfWorker.readAnnotations(buf);
	console.log(annotations);
}

main();
