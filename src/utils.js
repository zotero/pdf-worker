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
