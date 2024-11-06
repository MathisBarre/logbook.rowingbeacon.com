import { Label } from "../../../_common/components/Label";

interface CommentSectionProps {
  value: string;
  onChange: (value: string) => void;
}

const CommentSection = ({ value, onChange }: CommentSectionProps) => {
  return (
    <div className="flex flex-col gap-1">
      <Label>Commentaire</Label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input"
        name="comment"
        id="comment"
        rows={3}
      />
    </div>
  );
};

export default CommentSection;
