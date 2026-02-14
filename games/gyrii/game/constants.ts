/**
 * Default camera zoom: distance-based zoom (mouse far from player = zoom out).
 * Can be overridden per weapon via WeaponConfig.cameraZoom.
 */
export interface CameraZoomConfig {
  /** Min camera radius (zoomed in when mouse is at player). */
  radiusMin: number;
  /** Max camera radius (zoomed out when mouse is far). */
  radiusMax: number;
  /** World-space distance from player at which zoom is fully "out" (capped). */
  mouseZoomMaxDist: number;
}

export const DEFAULT_CAMERA_ZOOM: CameraZoomConfig = {
  radiusMin: 25,
  radiusMax: 30,
  mouseZoomMaxDist: 25,
};
