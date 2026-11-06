<?php // Uso: php generar_hash.php "tu-contraseña"
echo password_hash($argv[1] ?? "", PASSWORD_DEFAULT); ?>
