<?php
require_once __DIR__ . '/../config/conexion.php';
if (!isset($_SESSION['id_usuario']) || $_SESSION['rol'] !== 'admin') {
    header("Location: " . BASE_URL . "/index.php?error=Acceso no autorizado");
    exit();
}
$id = isset($_GET['id']) ? intval($_GET['id']) : 0;
$stmt = $conexion->prepare("SELECT * FROM usuarios WHERE id_usuario = ?");
$stmt->bind_param("i", $id);
$stmt->execute();
$res = $stmt->get_result();
if ($res->num_rows === 0) {
    header("Location: " . BASE_URL . "/admin/usuarios.php");
    exit();
}
$usuario = $res->fetch_assoc();
include __DIR__ . '/../includes/header.php';
?>

<div class="container my-5">
    <div class="row justify-content-center">
        <div class="col-md-7">
            <div class="card shadow border-0" style="border-radius: 20px;">
                <div class="card-header bg-warning" style="border-radius: 20px 20px 0 0;"><h4 class="mb-0"><i class="bi bi-pencil me-2"></i>Editar Usuario</h4></div>
                <div class="card-body p-4">
                    <form action="<?php echo BASE_URL; ?>/admin/actualizar_usuario.php" method="POST">
                        <input type="hidden" name="id_usuario" value="<?php echo $usuario['id_usuario']; ?>">
                        <div class="mb-3"><label class="form-label">Nombre completo</label><input type="text" name="nombre" class="form-control" value="<?php echo htmlspecialchars($usuario['nombre']); ?>" required></div>
                        <div class="mb-3"><label class="form-label">Usuario</label><input type="text" name="usuario" class="form-control" value="<?php echo htmlspecialchars($usuario['usuario']); ?>" required></div>
                        <div class="mb-3"><label class="form-label">Email</label><input type="email" name="email" class="form-control" value="<?php echo htmlspecialchars($usuario['email']); ?>" required></div>
                        <div class="row">
                            <div class="col-md-6 mb-3"><label class="form-label">Teléfono</label><input type="text" name="telefono" class="form-control" value="<?php echo htmlspecialchars($usuario['telefono']);"></div>
                            <div class="col-md-6 mb-3"><label class="form-label">Ciudad</label><input type="text" name="ciudad" class="form-control" value="<?php echo htmlspecialchars($usuario['ciudad']);"></div>
                        </div>
                        <div class="mb-3"><label class="form-label">Dirección</label><input type="text" name="direccion" class="form-control" value="<?php echo htmlspecialchars($usuario['direccion']);"></div>
                        <div class="mb-3"><label class="form-label">Rol</label>
                            <select name="rol" class="form-select" required>
                                <option value="cliente" <?php echo ($usuario['rol']=='cliente')?'selected':''; ?>>Cliente</option>
                                <option value="admin" <?php echo ($usuario['rol']=='admin')?'selected':''; ?>>Administrador</option>
                            </select>
                        </div>
                        <div class="mb-3"><label class="form-label">Nueva contraseña</label><input type="password" name="password" class="form-control"><div class="form-text">Déjala vacía si no deseas cambiarla.</div></div>
                        <div class="d-grid gap-2">
                            <button type="submit" class="btn btn-warning">Actualizar usuario</button>
                            <a href="<?php echo BASE_URL; ?>/admin/usuarios.php" class="btn btn-secondary">Cancelar</a>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    </div>
</div>

<?php include __DIR__ . '/../includes/footer.php'; ?>
