export function CaseSkeleton() {
  return (
    <div className="flex h-full animate-pulse flex-col p-6">
      <div className="flex justify-between gap-4">
        <div className="space-y-2">
          <div className="h-6 w-48 rounded bg-rule" />
          <div className="h-4 w-24 rounded bg-rule" />
        </div>
        <div className="h-12 w-32 rounded bg-rule" />
      </div>
      <div className="mt-6 h-5 w-full max-w-md rounded bg-rule" />
      <div className="mt-2 h-5 w-full max-w-lg rounded bg-rule" />
      <div className="mt-2 h-5 w-full max-w-sm rounded bg-rule" />
      <div className="mt-8 flex gap-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-8 w-20 rounded-full bg-rule" />
        ))}
      </div>
      <div className="mt-8 h-40 rounded-[8px] bg-rule" />
    </div>
  );
}
