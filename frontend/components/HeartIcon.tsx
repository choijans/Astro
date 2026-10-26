interface HeartIconProps {
  filled: boolean;
}

export function HeartIcon({ filled }: HeartIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-5 w-5"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M12 20.5s-7.5-4.5-10-9.1C.5 8 2 4.5 5.5 4c2-.3 3.8.6 5 2.2C11.7 4.6 13.5 3.7 15.5 4c3.5.5 5 4 3.5 7.4-2.5 4.6-10 9.1-10 9.1z" />
    </svg>
  );
}
