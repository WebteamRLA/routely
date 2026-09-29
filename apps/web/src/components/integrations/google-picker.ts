/**
 * Loading and opening the Google Picker.
 *
 * The Picker is Google's own file-browser window. It matters here for a reason that is easy to miss:
 * it is what lets Routely hold the **`drive.file`** scope instead of a Drive-wide one. The customer
 * browses their whole Drive inside Google's UI, using their own session, and Google grants this app
 * access to *only* the file they choose. Routely never gets the ability to enumerate or read
 * anything else — and `drive.file` is non-sensitive, so the integration needs no Google verification
 * review at all. A dropdown built inside Routely would have required the restricted
 * `drive.metadata.readonly` scope, verification, and a paid annual security assessment.
 *
 * Kept out of the React component because it is imperative global-script loading: `api.js` attaches
 * `gapi` to `window`, and a second concurrent call must wait for the first rather than inject the
 * script twice.
 */

/** Minimal shapes for the globals `api.js` installs. Not exhaustive — only what is used here. */
interface PickerDocument {
  id: string;
  name?: string;
}

interface PickerResponse {
  action: string;
  docs?: PickerDocument[];
}

interface PickerBuilder {
  addView: (view: unknown) => PickerBuilder;
  setOAuthToken: (token: string) => PickerBuilder;
  setDeveloperKey: (key: string) => PickerBuilder;
  setAppId: (appId: string) => PickerBuilder;
  setTitle: (title: string) => PickerBuilder;
  setCallback: (callback: (response: PickerResponse) => void) => PickerBuilder;
  build: () => { setVisible: (visible: boolean) => void };
}

interface GooglePickerNamespace {
  PickerBuilder: new () => PickerBuilder;
  ViewId: { SPREADSHEETS: unknown };
  Action: { PICKED: string; CANCEL: string };
}

declare global {
  interface Window {
    gapi?: { load: (name: string, callback: () => void) => void };
    google?: { picker?: GooglePickerNamespace };
  }
}

const API_JS = "https://apis.google.com/js/api.js";

/** Shared across calls so two buttons cannot inject the script twice. */
let pickerReady: Promise<GooglePickerNamespace> | null = null;

/**
 * Loads `api.js` and the picker module, resolving with the picker namespace.
 *
 * Rejects rather than hanging when the script is blocked — an extension or a strict corporate proxy
 * can and does block `apis.google.com`, and a promise that never settles would leave the button
 * spinning forever with nothing to tell the customer.
 */
function loadPicker(): Promise<GooglePickerNamespace> {
  if (pickerReady) return pickerReady;

  pickerReady = new Promise<GooglePickerNamespace>((resolve, reject) => {
    const settle = (): void => {
      const picker = window.google?.picker;
      if (picker) resolve(picker);
      else reject(new Error("Google's file picker loaded but did not initialise."));
    };

    const loadModule = (): void => {
      if (!window.gapi) {
        reject(new Error("Google's file picker could not be loaded."));
        return;
      }

      window.gapi.load("picker", settle);
    };

    if (window.gapi) {
      loadModule();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${API_JS}"]`);

    if (existing) {
      existing.addEventListener("load", loadModule, { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Google's file picker could not be loaded.")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = API_JS;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", loadModule, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Google's file picker could not be loaded.")),
      { once: true },
    );
    document.head.append(script);
  }).catch((error: unknown) => {
    // Not cached on failure, so a customer who unblocks the script and retries is not stuck with the
    // rejected promise forever.
    pickerReady = null;
    throw error;
  });

  return pickerReady;
}

export interface PickedSpreadsheet {
  spreadsheetId: string;
  name: string | null;
}

/**
 * Opens the picker and resolves with the chosen spreadsheet, or null if the customer cancelled.
 *
 * Only spreadsheets are shown: `ViewId.SPREADSHEETS` filters to that MIME type, so a customer cannot
 * pick a document and then wonder why the sync fails.
 */
export async function pickSpreadsheet({
  accessToken,
  developerKey,
  appId,
  title = "Choose a spreadsheet for this website",
}: {
  accessToken: string;
  developerKey: string;
  appId: string;
  title?: string;
}): Promise<PickedSpreadsheet | null> {
  const picker = await loadPicker();

  return new Promise<PickedSpreadsheet | null>((resolve) => {
    new picker.PickerBuilder()
      .addView(picker.ViewId.SPREADSHEETS)
      .setOAuthToken(accessToken)
      .setDeveloperKey(developerKey)
      // Without the project number Google does not associate the picked file with this app, and the
      // write that follows fails with a 404 that looks like a missing spreadsheet.
      .setAppId(appId)
      .setTitle(title)
      .setCallback((response) => {
        if (response.action === picker.Action.PICKED) {
          const doc = response.docs?.[0];
          resolve(doc ? { spreadsheetId: doc.id, name: doc.name ?? null } : null);
          return;
        }

        // CANCEL, and anything else Google adds later, is "no choice made" rather than an error.
        if (response.action === picker.Action.CANCEL) resolve(null);
      })
      .build()
      .setVisible(true);
  });
}

/** True when the browser-side configuration the picker needs is present. */
export function isPickerConfigured(developerKey?: string, appId?: string): boolean {
  return Boolean(developerKey && appId);
}
