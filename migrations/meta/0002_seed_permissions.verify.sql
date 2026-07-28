SELECT CASE
  WHEN (SELECT COUNT(*) FROM permissions) = 20
    AND (SELECT COUNT(*) FROM roles WHERE is_system = 1) = 2
    AND (
      SELECT COUNT(*)
      FROM role_permissions
      WHERE role_id = '00000000-0000-4000-8000-000000000001'
    ) = 20
  THEN 1
  ELSE 0
END AS permission_seed_complete;
