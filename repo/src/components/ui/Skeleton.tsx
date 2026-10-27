import { cn } from "../../lib/utils";

interface SkeletonProps {
  className?: string;
  variant?: "text" | "rect" | "circle";
  width?: string | number;
  height?: string | number;
  lines?: number;
}

export function Skeleton({ 
  className, 
  variant = "rect", 
  width, 
  height,
  lines = 1 
}: SkeletonProps) {
  if (variant === "text" || lines > 1) {
    return (
      <div className={cn("space-y-2", className)}>
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="ic-skel"
            style={{
              width: width || (i === lines - 1 ? "75%" : "100%"),
              height: height || 12,
            }}
          />
        ))}
      </div>
    );
  }

  if (variant === "circle") {
    return (
      <div
        className={cn("ic-skel rounded-full", className)}
        style={{ width: width || 32, height: height || 32 }}
      />
    );
  }

  return (
    <div
      className={cn("ic-skel", className)}
      style={{ width, height }}
    />
  );
}

// Preset skeletons for common use cases
export function FileTreeSkeleton() {
  return (
    <div className="space-y-1 p-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <Skeleton variant="rect" width={16} height={16} />
          <Skeleton variant="text" width={`${60 + Math.random() * 30}%`} height={12} />
        </div>
      ))}
    </div>
  );
}

export function ChatMessageSkeleton() {
  return (
    <div className="flex gap-3 p-4">
      <Skeleton variant="circle" width={28} height={28} />
      <div className="flex-1 space-y-2">
        <Skeleton variant="text" width={96} height={12} />
        <Skeleton variant="text" lines={3} />
      </div>
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Skeleton variant="rect" width={32} height={32} className="rounded-lg" />
        <Skeleton variant="text" width={120} height={14} />
      </div>
      <Skeleton variant="text" lines={2} />
    </div>
  );
}
