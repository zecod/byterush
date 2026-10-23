import { HugeiconsIcon } from "@hugeicons/react";
import {
  Doc01Icon,
  File01Icon,
  FileZipIcon,
  MusicNote01Icon,
  PackageIcon,
  Video01Icon,
} from "@hugeicons/core-free-icons";
import type { Category } from "../api";

export type IconData = typeof File01Icon;

/** Hugeicons with the app's default weight. */
export function Icon({ icon, size = 16, className }: { icon: IconData; size?: number; className?: string }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.6} className={className} />;
}

export const categoryIcon: Record<Category, IconData> = {
  general: File01Icon,
  compressed: FileZipIcon,
  documents: Doc01Icon,
  music: MusicNote01Icon,
  programs: PackageIcon,
  video: Video01Icon,
};

export const categoryLabel: Record<Category, string> = {
  general: "general",
  compressed: "compressed",
  documents: "documents",
  music: "music",
  programs: "programs",
  video: "video",
};

export function CategoryBadge({ category }: { category: Category }) {
  return (
    <span className={`file-icon cat-${category}`}>
      <Icon icon={categoryIcon[category]} size={15} />
    </span>
  );
}
