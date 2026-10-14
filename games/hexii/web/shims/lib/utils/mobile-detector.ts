interface WindowWithOpera extends Window {
  opera?: string;
}

export function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;

  // In dev, width stands in for a phone so desktop can show the touch controls.
  if (import.meta.env.DEV) {
    return window.innerWidth <= 768 || window.innerHeight <= 768;
  }

  const windowWithOpera = window as WindowWithOpera;
  const userAgent =
    navigator.userAgent || navigator.vendor || windowWithOpera.opera || "";
  const mobileRegex =
    /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i;
  const isSmallScreen = window.innerWidth <= 768 || window.innerHeight <= 768;
  const hasTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;

  return mobileRegex.test(userAgent) || (isSmallScreen && hasTouch);
}
