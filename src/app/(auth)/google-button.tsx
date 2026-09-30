import { GoogleIcon } from "@/components/brand/google-icon";
import { Button } from "@/components/ui/button";

// Submits its parent <form> to the Google action. formNoValidate so the
// email/password `required` fields don't block the Google flow.
export function GoogleButton({
  formAction,
  loading,
  disabled,
}: {
  formAction: (form: FormData) => void;
  loading: boolean;
  disabled: boolean;
}) {
  return (
    <Button
      type="submit"
      variant="outline"
      formAction={formAction}
      formNoValidate
      loading={loading}
      disabled={disabled}
      className="w-full"
    >
      {!loading && <GoogleIcon className="size-4" />}
      Continue with Google
    </Button>
  );
}

export function OrDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-xs text-muted">
      <span className="h-px flex-1 bg-line" />
      {label}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
