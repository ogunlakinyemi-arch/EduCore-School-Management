import { useEffect, useRef, useState } from "react";
import { ImagePlus, LoaderCircle, Trash2, Upload } from "lucide-react";
import { useGetAuthorizedContext } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";

type StudentPhotoFieldProps = {
  schoolId: number;
  studentId: number;
  passportUrl: string | null | undefined;
  onUpdated: () => void;
};

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

async function errorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json();
    if (typeof payload?.error === "string") return payload.error;
  } catch {
    // Use the status-based message below when the response is not JSON.
  }
  return `Photo request failed (${response.status})`;
}

function photoSource(passportUrl: string | null | undefined, schoolId: number, studentId: number, version: number) {
  if (!passportUrl) return null;
  const managedPhotoPath = passportUrl.startsWith("/objects/student-photos/");
  const protectedEndpoint = passportUrl.startsWith("/api/students/") && passportUrl.includes("/photo?");
  if (managedPhotoPath || protectedEndpoint) {
    return `/api/students/${studentId}/photo?schoolId=${schoolId}&v=${version}`;
  }
  return passportUrl;
}

export function StudentPhotoField({
  schoolId,
  studentId,
  passportUrl,
  onUpdated,
}: StudentPhotoFieldProps) {
  const contextQuery = useGetAuthorizedContext();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoVersion, setPhotoVersion] = useState(0);
  const [photoOverride, setPhotoOverride] = useState<string | null | undefined>(undefined);
  const canManage = contextQuery.data?.roles?.some((role: any) =>
    role.role === "SCHOOL_ADMIN" && role.schoolId === schoolId && role.status === "ACTIVE"
  ) === true;
  const source = photoOverride === null
    ? null
    : photoSource(photoOverride ?? passportUrl, schoolId, studentId, photoVersion);

  useEffect(() => {
    setPhotoVersion((current) => current + 1);
    setPhotoOverride(undefined);
  }, [passportUrl]);

  const uploadPhoto = async (file: File) => {
    setError(null);
    if (!ALLOWED_TYPES.has(file.type.toLowerCase())) {
      setError("Choose a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size < 1 || file.size > MAX_PHOTO_BYTES) {
      setError("The photo must be no larger than 3 MB.");
      return;
    }

    setBusy(true);
    try {
      const request = await fetch(`/api/students/${studentId}/photo-upload-request`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId, contentType: file.type, size: file.size }),
      });
      if (!request.ok) throw new Error(await errorMessage(request));
      const uploadRequest = await request.json();
      if (typeof uploadRequest.uploadURL !== "string" || typeof uploadRequest.objectPath !== "string") {
        throw new Error("The server returned an invalid photo upload request.");
      }

      const upload = await fetch(uploadRequest.uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!upload.ok) throw new Error(`Photo upload failed (${upload.status}). Please try again.`);

      const confirmation = await fetch(`/api/students/${studentId}/photo-confirm`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId, objectPath: uploadRequest.objectPath }),
      });
      if (!confirmation.ok) throw new Error(await errorMessage(confirmation));
      setPhotoVersion((current) => current + 1);
      setPhotoOverride(`/api/students/${studentId}/photo?schoolId=${schoolId}`);
      onUpdated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not upload the student photo.");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const removePhoto = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/students/${studentId}/photo?schoolId=${schoolId}`,
        { method: "DELETE", credentials: "same-origin" },
      );
      if (!response.ok) throw new Error(await errorMessage(response));
      setPhotoVersion((current) => current + 1);
      setPhotoOverride(null);
      onUpdated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove the student photo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3" aria-label="Student passport photo">
      <div className="flex items-center gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
          {source ? (
            <img src={source} alt="Student passport" className="h-full w-full object-cover" />
          ) : (
            <ImagePlus className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Passport photo</p>
          <p className="text-xs text-muted-foreground">JPEG, PNG, or WebP · up to 3 MB</p>
          {canManage && (
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                aria-label="Choose student passport photo"
                disabled={busy}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) void uploadPhoto(file);
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                {busy ? <LoaderCircle className="animate-spin" /> : <Upload />}
                {source ? "Replace photo" : "Upload photo"}
              </Button>
              {source && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void removePhoto()}
                  aria-label="Remove student photo"
                >
                  {busy ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
                  Remove
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
      {busy && <p className="text-xs text-muted-foreground" role="status">Saving photo…</p>}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </section>
  );
}