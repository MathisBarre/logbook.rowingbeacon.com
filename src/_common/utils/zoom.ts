import { useState, useEffect } from "react";

function zoom(zoomValue: number) {
  const root = document.documentElement;

  if (root) {
    let fontSize = parseInt(root.style.getPropertyValue("--root-font-size"));

    if (isNaN(fontSize)) {
      root.style.setProperty("--root-font-size", "16");
    }

    fontSize = parseInt(root.style.getPropertyValue("--root-font-size"));

    root.style.setProperty("--root-font-size", fontSize + zoomValue + "px");
    localStorage.setItem("zoomLevel", fontSize + zoomValue + "px");
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

export function useZoom() {
  const [zoomPercentage, setZoomPercentage] = useState(getZoomPercentage());

  useEffect(() => {
    const savedZoomLevel = localStorage.getItem("zoomLevel");
    if (savedZoomLevel) {
      const root = document.documentElement;
      root.style.setProperty("--root-font-size", savedZoomLevel);
      setZoomPercentage(getZoomPercentage());
    }
  }, []);

  return {
    zoomIn: () => {
      zoom(1);
      setZoomPercentage(getZoomPercentage());
    },
    zoomOut: () => {
      zoom(-1);
      setZoomPercentage(getZoomPercentage());
    },
    zoomPercentage,
  };
}
