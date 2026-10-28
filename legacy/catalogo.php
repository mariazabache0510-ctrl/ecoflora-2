<?php
require_once __DIR__ . '/config/conexion.php';
include __DIR__ . '/includes/header.php';

$categoria_filtro = isset($_GET['categoria']) ? intval($_GET['categoria']) : 0;
$busqueda = isset($_GET['busqueda']) ? trim($_GET['busqueda']) : '';

$sql = "SELECT p.*, c.nombre as categoria FROM plantas p JOIN categorias c ON p.id_categoria = c.id_categoria WHERE 1=1";
$params = [];
$types = "";

if ($categoria_filtro > 0) {
    $sql .= " AND p.id_categoria = ?";
    $params[] = $categoria_filtro;
    $types .= "i";
}
if (!empty($busqueda)) {
    $sql .= " AND (p.nombre LIKE ? OR p.nombre_cientifico LIKE ? OR p.descripcion LIKE ?)";
    $like = "%$busqueda%";
    $params[] = $like; $params[] = $like; $params[] = $like;
    $types .= "sss";
}
$sql .= " ORDER BY p.destacada DESC, p.nombre ASC";

$stmt = $conexion->prepare($sql);
if (!empty($params)) $stmt->bind_param($types, ...$params);
$stmt->execute();
$plantas = $stmt->get_result();

$categorias = $conexion->query("SELECT * FROM categorias");
?>

<div class="container my-5">
    <h2 class="fw-bold mb-4" style="color: var(--verde-oscuro);"><i class="bi bi-grid-3x3-gap me-2"></i>Catálogo de plantas</h2>
    <div class="card shadow-sm border-0 mb-4 p-3" style="border-radius: 15px;">
        <form method="GET" class="row g-3 align-items-end">
            <div class="col-md-4">
                <label class="form-label small text-muted">Buscar</label>
                <input type="text" name="busqueda" class="form-control" placeholder="Nombre, científico..." value="<?php echo htmlspecialchars($busqueda); ?>">
            </div>
            <div class="col-md-3">
                <label class="form-label small text-muted">Categoría</label>
                <select name="categoria" class="form-select">
                    <option value="0">Todas</option>
                    <?php while($cat = $categorias->fetch_assoc()): ?>
                        <option value="<?php echo $cat['id_categoria']; ?>" <?php echo ($categoria_filtro == $cat['id_categoria']) ? 'selected' : ''; ?>><?php echo $cat['nombre']; ?></option>
                    <?php endwhile; ?>
                </select>
            </div>
            <div class="col-md-2">
                <button type="submit" class="btn btn-ecoflora w-100">Filtrar</button>
            </div>
            <?php if($categoria_filtro || $busqueda): ?>
            <div class="col-md-2">
                <a href="<?php echo BASE_URL; ?>/catalogo.php" class="btn btn-outline-secondary w-100">Limpiar</a>
            </div>
            <?php endif; ?>
        </form>
    </div>

    <div class="row g-4">
        <?php if($plantas->num_rows === 0): ?>
            <div class="col-12 text-center py-5">
                <i class="bi bi-search fs-1 text-muted"></i>
                <p class="text-muted mt-2">No encontramos plantas con esos criterios.</p>
            </div>
        <?php endif; ?>
        <?php while($planta = $plantas->fetch_assoc()): ?>
        <div class="col-md-6 col-lg-4 col-xl-3">
            <div class="card card-planta h-100">
                <div style="overflow: hidden; height: 220px; position: relative;">
                    <img src="https://placehold.co/600x400/2d6a4f/ffffff?text=<?php echo urlencode($planta['nombre']); ?>" class="card-img-top w-100 h-100" alt="<?php echo $planta['nombre']; ?>" style="object-fit: cover;">
                    <?php if($planta['destacada']): ?>
                        <span class="badge bg-warning position-absolute top-0 end-0 m-2"><i class="bi bi-star-fill"></i> Destacada</span>
                    <?php endif; ?>
                </div>
                <div class="card-body d-flex flex-column">
                    <span class="badge-categoria mb-2 align-self-start"><?php echo $planta['categoria']; ?></span>
                    <h5 class="card-title fw-bold"><?php echo $planta['nombre']; ?></h5>
                    <p class="text-muted small mb-1"><em><?php echo $planta['nombre_cientifico']; ?></em></p>
                    <p class="card-text text-muted small flex-grow-1"><?php echo substr($planta['descripcion'], 0, 80); ?>...</p>
                    <div class="d-flex justify-content-between align-items-center mt-3">
                        <span class="precio-planta">$<?php echo number_format($planta['precio'], 0, ',', '.'); ?></span>
                        <a href="<?php echo BASE_URL; ?>/planta.php?id=<?php echo $planta['id_planta']; ?>" class="btn btn-outline-ecoflora btn-sm">Ver más</a>
                    </div>
                </div>
            </div>
        </div>
        <?php endwhile; ?>
    </div>
</div>

<?php include __DIR__ . '/includes/footer.php'; ?>
