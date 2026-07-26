import * as api from "@client/api";
import { SettingsSectionFrame } from "@client/pages/settings/components/SettingsSectionFrame";
import { useMutation, useQuery } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { toast } from "sonner";
import { showErrorToast } from "@/client/lib/error-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type AccountSettingsSectionProps = {
  layoutMode?: "accordion" | "panel";
};

export const AccountSettingsSection: React.FC<AccountSettingsSectionProps> = ({
  layoutMode,
}) => {
  const [password, setPassword] = useState("");
  const meQuery = useQuery({
    queryKey: ["auth", "me"],
    queryFn: api.getCurrentAuthUser,
    retry: false,
  });
  const changePasswordMutation = useMutation({
    mutationFn: (password: string) => api.changeOwnPassword(password),
    onSuccess: () => {
      setPassword("");
      toast.success("Password changed");
    },
    onError: (error) => {
      showErrorToast(error, "Failed to change password");
    },
  });

  return (
    <SettingsSectionFrame mode={layoutMode} title="Account" value="account">
      <div className="space-y-6">
        <div className="space-y-1">
          <div className="text-sm font-semibold">Signed in as</div>
          <p className="text-sm text-muted-foreground">
            {meQuery.data?.username ?? "your account"}
          </p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <div className="text-sm font-semibold">Change password</div>
            <p className="text-sm text-muted-foreground">
              Use at least 8 characters.
            </p>
          </div>
          <div className="flex max-w-md gap-2">
            <Input
              aria-label="New password"
              autoComplete="new-password"
              onChange={(event) => setPassword(event.currentTarget.value)}
              placeholder="New password"
              type="password"
              value={password}
            />
            <Button
              type="button"
              disabled={changePasswordMutation.isPending || password.length < 8}
              onClick={() => changePasswordMutation.mutate(password)}
            >
              Change
            </Button>
          </div>
        </div>

        <div className="border-t pt-6">
          <Button
            type="button"
            variant="outline"
            onClick={() => void api.logout()}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </div>
    </SettingsSectionFrame>
  );
};
