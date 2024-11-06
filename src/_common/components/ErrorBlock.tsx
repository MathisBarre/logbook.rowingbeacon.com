interface ErrorBlockProps {
  message?: string;
  refetch?: () => void;
}

export const ErrorBlock = ({
  message = "Erreur",
  refetch,
}: ErrorBlockProps) => {
  return (
    <div className="flex justify-between items-center bg-error-100 p-2 pl-4 rounded border-error-200 border">
      <div className="text-error-800 font-medium">{message}</div>
      {refetch && (
        <button className="btn-error" onClick={() => refetch()}>
          Réessayer
        </button>
      )}
    </div>
  );
};
