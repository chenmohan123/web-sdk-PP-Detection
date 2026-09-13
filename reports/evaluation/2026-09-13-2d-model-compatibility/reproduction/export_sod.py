"""校验固定来源后调用官方导出；仅重定向临时缓存目录。"""
from pathlib import Path
import os,runpy,sys,hashlib,json,zipfile
root=Path.cwd().resolve()
u=root/".tmp/phase2/upstream/PaddleDetection-b25522a0f4bde8c80603f3ba5e3472059972e3b5"
out=root/".tmp/sod-20260913"
lock=json.loads((Path(__file__).resolve().parents[1]/"sources.lock.json").read_text(encoding="utf-8"))
archive=root/".tmp/phase2/downloads/paddledetection.zip"
assert archive.stat().st_size==lock["archive"]["bytes"]
assert hashlib.sha256(archive.read_bytes()).hexdigest()==lock["archive"]["sha256"]
with zipfile.ZipFile(archive) as z:
    for item in z.infolist():
        if not item.is_dir():
            assert (u.parent/item.filename).read_bytes()==z.read(item),item.filename
weight=out/"ppyoloe_plus_sod_crn_l_80e_coco.pdparams"
assert weight.stat().st_size==lock["weights"]["bytes"]
assert hashlib.sha256(weight.read_bytes()).hexdigest()==lock["weights"]["sha256"]
os.environ["MPLCONFIGDIR"]=str(out/"matplotlib")
import paddle.jit.dy2static.utils as translator_utils
def local_temp_dir():
    p=out/"paddle-cache"/str(os.getpid())
    p.mkdir(parents=True,exist_ok=True)
    return str(p)
translator_utils.get_temp_dir=local_temp_dir
os.chdir(u)
sys.path.insert(0,str(u))
sys.argv=[str(u/"tools/export_model.py"),"-c","configs/smalldet/ppyoloe_plus_sod_crn_l_80e_coco.yml","-o","use_gpu=False",f"weights={out/'ppyoloe_plus_sod_crn_l_80e_coco.pdparams'}","TestReader.inputs_def.image_shape=[3,640,640]","export_onnx=True","--output_dir",str(out/"exported")]
print(sys.argv,flush=True)
runpy.run_path(sys.argv[0],run_name="__main__")
