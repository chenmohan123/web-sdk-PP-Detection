"""目标检测质量与一致性评测公共接口。"""

from .coco import evaluate_coco
from .matching import compare_detections

__all__ = ["compare_detections", "evaluate_coco"]
