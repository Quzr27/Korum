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

interface QuitGuardDialogProps {
  open: boolean;
  isQuitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function QuitGuardDialog({
  open,
  isQuitting,
  onCancel,
  onConfirm,
}: QuitGuardDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isQuitting) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Quit Korum?</AlertDialogTitle>
          <AlertDialogDescription>
            All running terminals will be closed. Your workspace layout and
            settings are saved automatically.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isQuitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isQuitting}
            onClick={(event) => {
              event.preventDefault();
              if (!isQuitting) onConfirm();
            }}
          >
            {isQuitting ? "Quitting\u2026" : "Quit"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
