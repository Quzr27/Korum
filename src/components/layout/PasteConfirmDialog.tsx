import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const PREVIEW_MAX_LINES = 5;

interface PasteConfirmDialogProps {
  open: boolean;
  text: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function PasteConfirmDialog({
  open,
  text,
  onCancel,
  onConfirm,
}: PasteConfirmDialogProps) {
  const lines = text.replace(/\n$/, "").split("\n");
  const lineCount = lines.length;
  const preview = lines.slice(0, PREVIEW_MAX_LINES).join("\n");
  const truncated = lineCount > PREVIEW_MAX_LINES;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm paste</AlertDialogTitle>
          <AlertDialogDescription>
            You are about to paste {lineCount} line{lineCount !== 1 ? "s" : ""}{" "}
            into the terminal.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <pre className="text-xs font-mono bg-muted rounded-md p-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-all">
          {preview}
          {truncated && (
            <span className="text-muted-foreground">
              {"\n"}... and {lineCount - PREVIEW_MAX_LINES} more line
              {lineCount - PREVIEW_MAX_LINES !== 1 ? "s" : ""}
            </span>
          )}
        </pre>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            Paste
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
