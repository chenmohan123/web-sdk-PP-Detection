import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type RefObject
} from "react";

type Point = { x: number; y: number };
type View = Point & { zoom: number };
const initialView: View = { zoom: 1, x: 0, y: 0 };
const limitZoom = (zoom: number): number => Math.min(8, Math.max(1, zoom));

export function useImageViewport(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  imageKey: string | undefined
) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState(initialView);
  const viewRef = useRef(initialView);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ view: View; points: Point[] } | undefined>(undefined);
  const moved = useRef(false);
  const [dragging, setDragging] = useState(false);

  const geometry = () => {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !viewport || canvas.width <= 0 || canvas.height <= 0) return undefined;
    // 保留布局的小数像素，避免高倍率时取整误差被放大到拖动边界。
    const bounds = viewport.getBoundingClientRect();
    const width = bounds.width - viewport.clientLeft * 2;
    const height = bounds.height - viewport.clientTop * 2;
    const fit = Math.min(width / canvas.width, height / canvas.height);
    return { width, height, fit, imageWidth: canvas.width, imageHeight: canvas.height };
  };
  const update = (next: View) => {
    const size = geometry();
    const zoom = limitZoom(next.zoom);
    const maxX = size ? Math.max(0, (size.imageWidth * size.fit * zoom - size.width) / 2) : 0;
    const maxY = size ? Math.max(0, (size.imageHeight * size.fit * zoom - size.height) / 2) : 0;
    const value = {
      zoom,
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y))
    };
    viewRef.current = value;
    setView(value);
  };
  const reset = () => {
    pointers.current.clear();
    gesture.current = undefined;
    setDragging(false);
    update(initialView);
  };
  const zoomAt = (
    zoom: number,
    anchor: Point,
    previous = viewRef.current,
    destination = anchor
  ) => {
    const nextZoom = limitZoom(zoom);
    const ratio = nextZoom / previous.zoom;
    update({
      zoom: nextZoom,
      x: destination.x - (anchor.x - previous.x) * ratio,
      y: destination.y - (anchor.y - previous.y) * ratio
    });
  };
  const point = (clientX: number, clientY: number): Point => {
    const viewport = viewportRef.current!;
    const bounds = viewport.getBoundingClientRect();
    return {
      x: clientX - bounds.left - bounds.width / 2,
      y: clientY - bounds.top - bounds.height / 2
    };
  };
  const rebaseGesture = () => {
    gesture.current = { view: viewRef.current, points: [...pointers.current.values()] };
  };
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (imageKey === undefined || event.button !== 0) return;
    if (pointers.current.size === 0) moved.current = false;
    pointers.current.set(event.pointerId, point(event.clientX, event.clientY));
    event.currentTarget.setPointerCapture(event.pointerId);
    rebaseGesture();
    if (pointers.current.size > 1) moved.current = true;
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId) || gesture.current === undefined) return;
    pointers.current.set(event.pointerId, point(event.clientX, event.clientY));
    const current = [...pointers.current.values()];
    const start = gesture.current;
    if (current.length >= 2 && start.points.length >= 2) {
      const midpoint = (points: Point[]): Point => ({
        x: (points[0].x + points[1].x) / 2,
        y: (points[0].y + points[1].y) / 2
      });
      const distance = (points: Point[]): number =>
        Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
      const initialDistance = distance(start.points);
      if (initialDistance > 0)
        zoomAt(
          (start.view.zoom * distance(current)) / initialDistance,
          midpoint(start.points),
          start.view,
          midpoint(current)
        );
      moved.current = true;
      setDragging(true);
    } else {
      const dx = current[0].x - start.points[0].x;
      const dy = current[0].y - start.points[0].y;
      if (Math.hypot(dx, dy) < 4 && !moved.current) return;
      moved.current = true;
      setDragging(true);
      update({ ...start.view, x: start.view.x + dx, y: start.view.y + dy });
    }
  };
  const pointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(event.pointerId)) return;
    if (event.type === "pointercancel" || event.type === "lostpointercapture") moved.current = true;
    rebaseGesture();
    if (pointers.current.size === 0) setDragging(false);
  };

  // 原生非被动监听允许在画布内缩放，同时阻止滚轮滚动外层页面。
  const handlersRef = useRef({ reset, update, zoomAt, point });
  handlersRef.current = { reset, update, zoomAt, point };
  useLayoutEffect(() => {
    handlersRef.current.reset();
    const viewport = viewportRef.current;
    if (viewport === null || imageKey === undefined) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const pixels =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
      handlersRef.current.zoomAt(
        viewRef.current.zoom * Math.exp(-Math.max(-500, Math.min(500, pixels)) * 0.002),
        handlersRef.current.point(event.clientX, event.clientY)
      );
      // 混合滚轮与拖动时，以新的倍率和当前指针位置继续手势。
      if (pointers.current.size > 0) {
        moved.current = true;
        rebaseGesture();
      }
    };
    viewport.addEventListener("wheel", wheel, { passive: false });
    const observer = new ResizeObserver(() => handlersRef.current.update(viewRef.current));
    observer.observe(viewport);
    return () => {
      viewport.removeEventListener("wheel", wheel);
      observer.disconnect();
    };
  }, [imageKey]);

  return {
    viewportRef,
    zoom: imageKey === undefined ? 1 : view.zoom,
    dragging,
    canvasStyle:
      imageKey === undefined
        ? undefined
        : ({
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
            transformOrigin: "center"
          } as CSSProperties),
    reset,
    zoomBy: (factor: number) => zoomAt(viewRef.current.zoom * factor, { x: 0, y: 0 }),
    focus: (box: { xMin: number; xMax: number; yMin: number; yMax: number }) => {
      const size = geometry();
      if (imageKey === undefined || !size) return;
      update({
        zoom: viewRef.current.zoom,
        x: (size.imageWidth / 2 - (box.xMin + box.xMax) / 2) * size.fit * viewRef.current.zoom,
        y: (size.imageHeight / 2 - (box.yMin + box.yMax) / 2) * size.fit * viewRef.current.zoom
      });
    },
    bindings: {
      onPointerDown: pointerDown,
      onPointerMove: pointerMove,
      onPointerUp: pointerEnd,
      onPointerCancel: pointerEnd,
      onLostPointerCapture: pointerEnd,
      onClickCapture: (event: React.MouseEvent<HTMLDivElement>) => {
        if (imageKey !== undefined && moved.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
    }
  };
}
