import { useState, useCallback, useEffect, useRef } from "react";
import type { InputAttachment } from "@/types/chat";
import { inputAttachmentRegistry } from "@/lib/plugins/inputAttachmentRegistry";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

function cleanupAttachment(att: InputAttachment) {
  const plugin = inputAttachmentRegistry.get(att.kind);
  plugin?.cleanup?.(att.data);
}

export function useInputAttachments() {
  const [attachments, setAttachments] = useState<InputAttachment[]>([]);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  const add = useCallback((kind: string, data: unknown) => {
    setAttachments((prev) => [...prev, { kind, data }]);
  }, []);

  const addFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach((file) => {
      if (file.size > MAX_FILE_SIZE) return;
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        const previewUrl = URL.createObjectURL(file);
        const kind = file.type.startsWith("image/") ? "image" : "file";
        setAttachments((prev) => [
          ...prev,
          { kind, data: { mimeType: file.type, fileName: file.name, content: base64, previewUrl } },
        ]);
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const addQuote = useCallback((text: string) => {
    setAttachments((prev) => {
      const removed = prev.filter((a) => a.kind === "quote");
      for (const att of removed) cleanupAttachment(att);
      return [...prev.filter((a) => a.kind !== "quote"), { kind: "quote", data: { text } }];
    });
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => {
      const item = prev[index];
      if (item) cleanupAttachment(item);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const clearAll = useCallback(() => {
    setAttachments((prev) => {
      for (const item of prev) cleanupAttachment(item);
      return [];
    });
  }, []);

  useEffect(() => {
    return () => {
      for (const item of attachmentsRef.current) cleanupAttachment(item);
    };
  }, []);

  return { attachments, add, addFiles, addQuote, removeAttachment, clearAll };
}
