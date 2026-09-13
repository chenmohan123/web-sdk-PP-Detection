// 一次性实验的坐标、裁切和去重行为校验。
import assert from 'node:assert/strict';
import {tileGrid,cropRaster,projectDetection,mergeDetections} from './tiling.mjs';
assert.deepEqual(tileGrid(10,8),[{x:0,y:0,width:6,height:5},{x:4,y:0,width:6,height:5},{x:0,y:3,width:6,height:5},{x:4,y:3,width:6,height:5}]);
for (const [width,height] of [[1,1],[11,9],[639,427]]) {
  const grid=tileGrid(width,height);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) assert.ok(grid.some(t=>x>=t.x&&x<t.x+t.width&&y>=t.y&&y<t.y+t.height));
}
const raster={width:10,height:8,rgba:Uint8ClampedArray.from({length:320},(_,i)=>i%251)};
const crop=cropRaster(raster,{x:4,y:3,width:6,height:5});
for(let y=0;y<5;y++) for(let x=0;x<6;x++) for(let c=0;c<4;c++) assert.equal(crop.rgba[(y*6+x)*4+c],raster.rgba[((y+3)*10+x+4)*4+c]);
assert.deepEqual(projectDetection({classId:2,score:.9,box:{x:-2,y:1,width:12,height:8}},{x:4,y:3,width:6,height:5}),{classId:2,score:.9,box:{x:4,y:4,width:6,height:4}});
assert.equal(projectDetection({classId:1,score:.5,box:{x:8,y:0,width:1,height:1}},{x:4,y:3,width:6,height:5}),null);
const box={x:5,y:6,width:10,height:10};
const a={classId:0,score:.9,box},b={classId:0,score:.8,box},c={classId:1,score:.7,box};
assert.deepEqual(mergeDetections([b,c,a]),[a,c]);
assert.deepEqual(mergeDetections([a,{...a,box:{...box,x:100}}]).length,2);
console.log('通过：尺寸覆盖、RGBA 裁切、框偏移裁剪、同类去重与异类保留');
