'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('gazeGlider', {
  getRuntimeInfo: () => ipcRenderer.invoke('runtime:get-info'),
  listDisplays: () => ipcRenderer.invoke('display:list'),
  beginCalibration: (displayId) => ipcRenderer.invoke('calibration:begin', displayId),
  updateCalibration: (payload) => ipcRenderer.send('calibration:update', payload),
  endCalibration: () => ipcRenderer.invoke('calibration:end'),
  setTrackingActive: (payload) => ipcRenderer.invoke('tracking:set-active', payload),
  updateOverlay: (payload) => ipcRenderer.send('tracking:update-overlay', payload),
  setCursorEnabled: (enabled) => ipcRenderer.invoke('cursor:set-enabled', Boolean(enabled)),
  getCursorPermission: () => ipcRenderer.invoke('cursor:get-permission'),
  promptCursorPermission: () => ipcRenderer.invoke('cursor:prompt-permission'),
  moveCursor: (payload) => ipcRenderer.send('cursor:move', payload),
  onCursorToggleRequested: (callback) => subscribe('shortcut:cursor-toggle', callback),
  onEmergencyStop: (callback) => subscribe('shortcut:emergency-stop', callback),
  onOverlayTracking: (callback) => subscribe('overlay:tracking', callback),
  onOverlayCalibration: (callback) => subscribe('overlay:calibration', callback),
});
