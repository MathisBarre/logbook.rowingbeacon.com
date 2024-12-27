import clsx from "clsx";
import { Label } from "../../_common/components/Label";
import { useState } from "react";

export const BoatLevelSystem = ({ boatId }: { boatId: string }) => {
  const [isChecked, setIsChecked] = useState(false);

  return (
    <div>
      <label className="flex gap-2 items-center">
        <input
          type="checkbox"
          name=""
          id=""
          checked={isChecked}
          onChange={() => setIsChecked(!isChecked)}
          className="input"
        />
        restreindre l&apos;usage de ce bateau
      </label>

      <p className="text-xs leading-5 mt-1">
        ⚠️ En restreignant l&apos;usage du bateau, les rameurs sans catégorie ou
        niveau ne pourront pas l&apos;utiliser
      </p>

      <div className={clsx(!isChecked && "hidden")}>
        <div className="h-4" />

        <hr />

        <div className="h-4" />

        <Label className="flex flex-col gap-1">
          Catégorie minimale
          <select name="" id="" className="input">
            <option value="">Aucune catégorie minimale</option>
            <option value="">J10</option>
            <option value="">J14</option>
            <option value="">J16</option>
            <option value="">J18</option>
            <option value="">Senior</option>
          </select>
        </Label>

        <div className="h-4" />

        <Label className="flex flex-col gap-1">
          Niveau minimale
          <select name="" id="" className="input">
            <option value="">Aucun niveau minimal</option>
            <option value="">Loisir</option>
            <option value="">Compétiteur</option>
          </select>
        </Label>
      </div>
    </div>
  );
};
