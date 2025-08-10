import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormField } from "../../../_common/components/Form";
import { Label } from "../../../_common/components/Label";
import { Input } from "../../../_common/components/Input";
import Button from "../../../_common/components/Button";
import { SimpleDialog } from "../../../_common/components/SimpleDialog";
import { GuestRowerTypeEnum } from "../../../_common/business/rower.rules";
import { AgeCategoryEnum } from "../../../_common/business/ageCategory.rules";
import { SeriousnessCategoryEnum } from "../../../_common/business/seriousness.rules";
import { getSeriousnessTypeTranslation } from "../../../_common/business/seriousness.rules";
import { useClubOverviewStore } from "../../../_common/store/clubOverview.store";
import { InfoIcon } from "lucide-react";

const AddGuestRowerSchema = z.object({
  name: z.string().min(1, "Le nom est requis"),
  guestType: z.nativeEnum(GuestRowerTypeEnum, {
    required_error: "Le type d'invité est requis",
    invalid_type_error: "Veuillez sélectionner un type d'invité",
  }),
  // Champs communs à tous les types d'invités
  category: z.nativeEnum(AgeCategoryEnum).optional(),
  type: z.nativeEnum(SeriousnessCategoryEnum).optional(),
  // Champs pour "invité pas encore inscrit"
  phoneNumber: z.string().optional(),
  email: z.string().email("Format d'email invalide").optional(),
});

type AddGuestRowerFormValues = z.infer<typeof AddGuestRowerSchema>;

interface AddGuestRowerFormProps {
  onSubmit: (values: AddGuestRowerFormValues) => void;
  onCancel: () => void;
}

const AddGuestRowerForm = ({ onSubmit, onCancel }: AddGuestRowerFormProps) => {
  const form = useForm<AddGuestRowerFormValues>({
    resolver: zodResolver(AddGuestRowerSchema),
    defaultValues: {
      name: "",
    },
  });

  const watchedGuestType = form.watch("guestType");

  const handleSubmit = (values: AddGuestRowerFormValues) => {
    // La validation Zod s'occupe maintenant de vérifier que guestType est défini

    // Validation conditionnelle - les champs niveau d'âge et type de pratique sont requis pour tous
    if (!values.category || !values.type) {
      form.setError("category", {
        message: "Le niveau d'âge est requis",
      });
      form.setError("type", {
        message: "Le type de pratique est requis",
      });
      return;
    }

    // Validation spécifique pour les "pas encore inscrits" - contact requis
    if (values.guestType === GuestRowerTypeEnum.NOT_YET_MEMBER) {
      if (!values.phoneNumber && !values.email) {
        form.setError("phoneNumber", {
          message: "Au moins un moyen de contact est requis",
        });
        form.setError("email", {
          message: "Au moins un moyen de contact est requis",
        });
        return;
      }
    }

    onSubmit(values);
    form.reset();
  };

  return (
    <Form {...form}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit(handleSubmit)(e);
        }}
        className="flex flex-col gap-4"
      >
        <FormField
          name="name"
          control={form.control}
          render={({ field, fieldState }) => (
            <div className="">
              <Label>Nom complet du rameur</Label>
              <Input {...field} />
              {fieldState.error && (
                <p className="form-error">{fieldState.error.message}</p>
              )}
            </div>
          )}
        />

        <FormField
          name="guestType"
          control={form.control}
          render={({ field, fieldState }) => (
            <div className="">
              <Label>Type d&apos;invité</Label>
              <select
                value={field.value || ""}
                onChange={field.onChange}
                className="input w-full mt-1"
              >
                <option value="" defaultChecked disabled>
                  --- Sélectionner un type d&apos;invité ---
                </option>
                <option value={GuestRowerTypeEnum.OTHER_CLUB}>
                  Rameur inscrit dans un autre club
                </option>
                <option value={GuestRowerTypeEnum.NOT_YET_MEMBER}>
                  Rameur pas encore inscrit dans le club
                </option>
              </select>
              {fieldState.error && (
                <p className="form-error">{fieldState.error.message}</p>
              )}
            </div>
          )}
        />

        {watchedGuestType && (
          <>
            <FormField
              name="category"
              control={form.control}
              render={({ field, fieldState }) => (
                <div className="">
                  <Label>Niveau d&apos;âge</Label>
                  <select
                    value={field.value || ""}
                    onChange={field.onChange}
                    className="input w-full mt-1"
                  >
                    <option value="" defaultChecked disabled>
                      --- Sélectionner un niveau d&apos;âge ---
                    </option>
                    {Object.values(AgeCategoryEnum).map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                  {fieldState.error && (
                    <p className="form-error">{fieldState.error.message}</p>
                  )}
                </div>
              )}
            />

            <FormField
              name="type"
              control={form.control}
              render={({ field, fieldState }) => (
                <div className="">
                  <Label>Type de pratique</Label>
                  <select
                    value={field.value || ""}
                    onChange={field.onChange}
                    className="input w-full mt-1"
                  >
                    <option value="" defaultChecked disabled>
                      --- Sélectionner un type de pratique ---
                    </option>
                    {Object.values(SeriousnessCategoryEnum).map((type) => (
                      <option key={type} value={type}>
                        {getSeriousnessTypeTranslation(type)}
                      </option>
                    ))}
                  </select>
                  {fieldState.error && (
                    <p className="form-error">{fieldState.error.message}</p>
                  )}
                </div>
              )}
            />
          </>
        )}

        {watchedGuestType === GuestRowerTypeEnum.NOT_YET_MEMBER && (
          <>
            <FormField
              name="phoneNumber"
              control={form.control}
              render={({ field, fieldState }) => (
                <div className="">
                  <Label>Numéro de téléphone</Label>
                  <Input {...field} />
                  {fieldState.error && (
                    <p className="form-error">{fieldState.error.message}</p>
                  )}
                </div>
              )}
            />

            <FormField
              name="email"
              control={form.control}
              render={({ field, fieldState }) => (
                <div className="">
                  <Label>Email</Label>
                  <Input {...field} type="email" />
                  {fieldState.error && (
                    <p className="form-error">{fieldState.error.message}</p>
                  )}
                </div>
              )}
            />

            <p className="text-xs text-blue-600 bg-blue-50 border border-blue-500 rounded p-2 flex gap-1 items-center">
              <InfoIcon className="size-3.5" /> Au moins un moyen de contact
              (téléphone ou email) est requis
            </p>
          </>
        )}

        <div className="flex gap-2 pt-4">
          <Button
            type="button"
            variant="outlined"
            onClick={onCancel}
            className="flex-1"
          >
            Annuler
          </Button>
          <Button type="submit" className="flex-1">
            Ajouter le rameur
          </Button>
        </div>
      </form>
    </Form>
  );
};

interface AddGuestRowerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onGuestRowerAdded: (guestRower: { id: string; name: string }) => void;
}

export const AddGuestRowerDialog = ({
  isOpen,
  onClose,
  onGuestRowerAdded,
}: AddGuestRowerDialogProps) => {
  const { addGuestRower } = useClubOverviewStore();

  const handleFormSubmit = (values: AddGuestRowerFormValues) => {
    // À ce stade, guestType est garanti d'être défini grâce à la validation Zod

    // Ajouter le rameur invité au store
    addGuestRower({
      name: values.name,
      guestType: values.guestType, // TypeScript sait maintenant que ce n'est pas null
      category: values.category,
      type: values.type,
      phoneNumber: values.phoneNumber,
      email: values.email,
    });

    // Notifier que le rameur a été ajouté (l'ID sera récupéré depuis le store)
    onGuestRowerAdded({ id: "", name: values.name });

    onClose();
  };

  return (
    <SimpleDialog
      open={isOpen}
      onOpenChange={onClose}
      title="Ajouter un rameur invité"
      className="max-w-md"
    >
      <AddGuestRowerForm onSubmit={handleFormSubmit} onCancel={onClose} />
    </SimpleDialog>
  );
};
