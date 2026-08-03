SELECT CASE
  WHEN (
    SELECT COUNT(*)
    FROM permissions
    WHERE key IN (
      'message.read', 'message.send', 'message.delete',
      'mailbox.create', 'mailbox.manage', 'mailbox.share',
      'user.read', 'user.manage', 'role.read', 'role.manage',
      'domain.read', 'domain.manage', 'signature.read', 'signature.manage',
      'settings.read', 'settings.manage', 'provider.sync',
      'webhook_event.read', 'webhook_event.delete', 'analytics.read'
    )
  ) = 20
    AND (SELECT COUNT(*) FROM roles WHERE is_system = 1) = 2
    AND (
      SELECT COUNT(*)
      FROM role_permissions
      WHERE role_id = '00000000-0000-4000-8000-000000000001'
        AND permission_key IN (
          'message.read', 'message.send', 'message.delete',
          'mailbox.create', 'mailbox.manage', 'mailbox.share',
          'user.read', 'user.manage', 'role.read', 'role.manage',
          'domain.read', 'domain.manage', 'signature.read', 'signature.manage',
          'settings.read', 'settings.manage', 'provider.sync',
          'webhook_event.read', 'webhook_event.delete', 'analytics.read'
        )
    ) = 20
  THEN 1
  ELSE 0
END AS permission_seed_complete;
