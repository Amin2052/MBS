import { BrowserWindow, dialog, nativeImage } from "electron";
import fs from "node:fs";

import { resizeImageToPng } from "./company-settings-service";

// ===================================================================
// Employee Photo — picker only.
//
// Reuses the same resize/compress behavior as the Company Logo
// (resizeImageToPng, imported above) so employee photos are stored at
// the same quality/size the rest of the app already relies on.
//
// This module intentionally does NOT talk to SQLite. The Company Logo
// lives in a single fixed row (company_settings, id = 1) that always
// exists, so "pick a file" and "persist it" can happen in one step.
// Employees are multiple rows that may not exist yet (Add Employee),
// so picking/resizing is decoupled from persistence: this returns a
// data URL for preview, and employee-repository.ts persists the
// decoded bytes once an employee id is available (on create or via
// the dedicated photo endpoints on an existing employee).
// ===================================================================

export interface PickedPhoto {
  dataUrl: string;
  mime: string;
}

/**
 * Opens a native "select image" dialog and returns a resized PNG as a
 * displayable data URL, or null if the user cancelled or the selected
 * file wasn't a valid image.
 */
export async function pickEmployeePhoto(
  mainWindow: BrowserWindow | null
): Promise<PickedPhoto | null> {

  if (!mainWindow) {
    return null;
  }

  const result = await dialog.showOpenDialog(
    mainWindow,
    {
      title: "Select Employee Photo",

      properties: [
        "openFile"
      ],

      filters: [
        {
          name: "Images",
          extensions: [
            "png",
            "jpg",
            "jpeg",
            "webp"
          ]
        }
      ]

    }
  );

  if (
    result.canceled ||
    result.filePaths.length === 0
  ) {

    return null;

  }

  try {

    const fileBuffer = fs.readFileSync(result.filePaths[0]);
    const image = nativeImage.createFromBuffer(fileBuffer);

    if (image.isEmpty()) {
      return null;
    }

    const pngBuffer = resizeImageToPng(image);

    return {
      dataUrl: `data:image/png;base64,${pngBuffer.toString("base64")}`,
      mime: "image/png"
    };

  }
  catch (error) {

    console.error("Failed to read/resize employee photo", error);
    return null;

  }

}

/**
 * Same picker as pickEmployeePhoto above (identical resize/compress
 * path), just with a dialog title that matches where it's actually
 * used -- the logged-in user's own Profile page, not the Employee
 * form. Kept as a separate function (rather than an accepted title-
 * text parameter) so neither call site's signature has to change.
 */
export async function pickProfilePhoto(
  mainWindow: BrowserWindow | null
): Promise<PickedPhoto | null> {

  if (!mainWindow) {
    return null;
  }

  const result = await dialog.showOpenDialog(
    mainWindow,
    {
      title: "Select Profile Photo",

      properties: [
        "openFile"
      ],

      filters: [
        {
          name: "Images",
          extensions: [
            "png",
            "jpg",
            "jpeg",
            "webp"
          ]
        }
      ]

    }
  );

  if (
    result.canceled ||
    result.filePaths.length === 0
  ) {

    return null;

  }

  try {

    const fileBuffer = fs.readFileSync(result.filePaths[0]);
    const image = nativeImage.createFromBuffer(fileBuffer);

    if (image.isEmpty()) {
      return null;
    }

    const pngBuffer = resizeImageToPng(image);

    return {
      dataUrl: `data:image/png;base64,${pngBuffer.toString("base64")}`,
      mime: "image/png"
    };

  }
  catch (error) {

    console.error("Failed to read/resize profile photo", error);
    return null;

  }

}

/**
 * Decodes a `data:<mime>;base64,<data>` string (as returned by
 * pickEmployeePhoto, and round-tripped through the renderer/IPC) back
 * into raw bytes for storage in the employees.photo_blob column.
 */
export function decodePhotoDataUrl(
  dataUrl: string
): { buffer: Buffer; mime: string } | null {

  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);

  if (!match) {
    return null;
  }

  return {
    mime: match[1],
    buffer: Buffer.from(match[2], "base64")
  };

}
