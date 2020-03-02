exports.quadPointsToRects = function (quadPoints) {
  let rects = [];
  for (let j = 0; j < quadPoints.length; j += 8) {
    let topLeft = { x: quadPoints[j + 4], y: quadPoints[j + 5] };
    let bottomRight = { x: quadPoints[j + 2], y: quadPoints[j + 3] };
    let x = Math.min(topLeft.x, bottomRight.x);
    let y = Math.min(topLeft.y, bottomRight.y);
    let width = Math.abs(topLeft.x - bottomRight.x);
    let height = Math.abs(topLeft.y - bottomRight.y);
    rects.push([x, y, x + width, y + height]);
  }
  return rects;
}

exports.pdfDateToIso = function (str) {
  let m = str.match(/([0-9]{4})([0-9]{2}|)([0-9]{2}|)([0-9]{2}|)([0-9]{2}|)([0-9]{2}|)/);
  if (!m) {
    return (new Date()).toISOString();
  }
  let d = [];
  for (let i = 1; i <= 6; i++) {
    if (!m[i]) break;
    d.push(parseInt(m[i]));
  }
  
  if (d[1]) {
    d[1] -= 1;
  }
  
  return (new Date(Date.UTC(...d))).toISOString();
}
