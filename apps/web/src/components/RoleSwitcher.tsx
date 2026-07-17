import { roles, type Role } from "@cf-startup/shared";

type RoleSwitcherProps = {
  role: Role;
  onChange: (role: Role) => void;
};

export function RoleSwitcher({ role, onChange }: RoleSwitcherProps) {
  return (
    <div className="role-switcher" aria-label="Role selector">
      {roles.map((item) => (
        <button
          className={item === role ? "active" : ""}
          key={item}
          onClick={() => onChange(item)}
          type="button"
        >
          {item}
        </button>
      ))}
    </div>
  );
}
