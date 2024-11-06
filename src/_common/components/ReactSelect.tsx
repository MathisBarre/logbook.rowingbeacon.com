import ReactSelectBase, { GroupBase, StylesConfig } from "react-select";

type ReactSelectProps = Parameters<typeof ReactSelectBase>[0];

export const ReactSelect = (props: ReactSelectProps) => {
  return <ReactSelectBase {...props} styles={SelectStyles} placeholder="" />;
};

export const SelectStyles: StylesConfig<
  unknown,
  boolean,
  GroupBase<unknown>
> = {
  control: (base) => ({
    ...base,
    borderColor: "rgb(75 85 99 / var(--tw-border-opacity));!important",
  }),
};
