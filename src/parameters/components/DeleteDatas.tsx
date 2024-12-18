import { OctagonAlertIcon, SkullIcon } from "lucide-react";
import { useState } from "react";
import { useAdminEditModeSystem } from "../../_common/store/adminEditMode.system";
import { useLogout } from "../../_common/utils/logout";
import Button from "../../_common/components/Button";

export const DeleteDatas = () => {
  const [textareaContent, setTextareaContent] = useState("");
  const adminEditSystem = useAdminEditModeSystem();
  const requiredTextToDelete = "Je souhaite supprimer toutes mes données";
  const logout = useLogout();
  const [adminPassword, setAdminPassword] = useState("");

  return (
    <div className="text-error-800 flex flex-col gap-2">
      <div className="flex gap-2 items-center">
        <OctagonAlertIcon />
        <span className="font-bold text-xl">Attention !</span>
      </div>
      <p>
        Vous êtes sur le point de supprimer toutes les données de
        l&apos;application.
      </p>

      <p>
        Il sera impossible de les récupérer une fois supprimée. Assurez-vous
        d&apos;avoir exporté les données importantes.
      </p>

      <p>
        Confirmez en écrivant exactement &quot;{requiredTextToDelete}&quot; dans
        le champ ci-dessous.
      </p>

      <textarea
        className="input"
        value={textareaContent}
        onChange={(e) => {
          setTextareaContent(e.target.value);
        }}
      />

      <p>Renseignez le mot de passe admin</p>

      <input
        className="input"
        type="password"
        name="password"
        id="password"
        value={adminPassword}
        onChange={(e) => {
          setAdminPassword(e.target.value);
        }}
      />

      <Button
        type="button"
        variant="primary"
        className="flex gap-2 items-center justify-center"
        color="danger"
        disabled={
          textareaContent !== requiredTextToDelete ||
          !adminEditSystem.isAdminPassword(adminPassword)
        }
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        onClick={async () => {
          if (textareaContent !== requiredTextToDelete) {
            return;
          }

          if (!adminEditSystem.isAdminPassword(adminPassword)) {
            return;
          }

          await logout();
        }}
      >
        <SkullIcon />
        Supprimer toutes mes données
      </Button>
    </div>
  );
};
