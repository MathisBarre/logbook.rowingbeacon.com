function zoom(zoomValue: number) {
  const root = document.documentElement;

  if (root) {
    let fontSize = parseInt(root.style.getPropertyValue("--root-font-size"));

    if (isNaN(fontSize)) {
      root.style.setProperty("--root-font-size", "16");
    }

    fontSize = parseInt(root.style.getPropertyValue("--root-font-size"));

    root.style.setProperty("--root-font-size", fontSize + zoomValue + "px");
  }
}

export const zoomIn = () => zoom(1);
export const zoomOut = () => zoom(-1);

export function resetZoom() {
  const root = document.documentElement;

  if (root) {
    root.style.setProperty("--root-font-size", 16 + "px");
  }
}

export function getZoomPercentage() {
  const root = document.documentElement;

  if (root) {
    const fontSize = parseInt(root.style.getPropertyValue("--root-font-size"));

    return Math.round((fontSize / 16) * 100);
  }

  return 100;
}
