import { logoutAction } from "./actions";

interface LogoutButtonProps {
  textColor?: string;
  hoverBgColor?: string;
}

export function LogoutButton({ textColor, hoverBgColor }: LogoutButtonProps) {
  return (
    <form action={logoutAction}>
      <button
        type="submit"
        className="w-full rounded-md px-3 py-2 text-left text-sm font-medium transition-colors"
        style={{
          color: textColor || "#64748b",
          backgroundColor: "transparent"
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = hoverBgColor || "#f1f5f9";
          e.currentTarget.style.color = textColor ? "#ffffff" : "#1e293b";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
          e.currentTarget.style.color = textColor || "#64748b";
        }}
      >
        Sign out
      </button>
    </form>
  );
}
