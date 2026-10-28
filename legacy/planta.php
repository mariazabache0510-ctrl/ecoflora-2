<?php
require_once __DIR__ . '/config/conexion.php';
include __DIR__ . '/includes/header.php';

$id = isset($_GET['id']) ? intval($_GET['id']) : 0;

$stmt = $conexion->prepare("SELECT p.*, c.nombre as categoria FROM plantas p JOIN categorias c ON p.id_categoria = c.id_categoria WHERE p.id_planta = ?");
$stmt->bind_param("i", $id);
$stmt->execute();
$res = $stmt->get_result();

if ($res->num_rows === 0) {
    echo '<div class="container my-5"><div class="alert alert-warning"><i class="bi bi-exclamation-triangle me-2"></i>Planta no encontrada.</div></div>';
    include __DIR__ . '/includes/footer.php';
    exit();
}

$planta = $res->fetch_assoc();

$rel = $conexion->prepare("SELECT id_planta, nombre, precio, imagen, nombre_cientifico FROM plantas WHERE id_categoria = ? AND id_planta != ? LIMIT 3");
$rel->bind_param("ii", $planta['id_categoria'], $id);
$rel->execute();
$relacionadas = $rel->get_result();
?>

<div class="container my-5">
    <nav aria-label="breadcrumb" class="mb-4">
        <ol class="breadcrumb">
            <li class="breadcrumb-item"><a href="<?php echo BASE_URL; ?>/index.php">Inicio</a></li>
            <li class="breadcrumb-item"><a href="<?php echo BASE_URL; ?>/catalogo.php">Catálogo</a></li>
            <li class="breadcrumb-item active"><?php echo $planta['nombre']; ?></li>
        </ol>
    </nav>

    <div class="row g-5">
        <div class="col-lg-6">
            <div class="detalle-imagen overflow-hidden">
                <img src="https://placehold.co/800x600/1b4332/ffffff?text=<?php echo urlencode($planta['nombre']); ?>" class="img-fluid w-100" alt="<?php echo $planta['nombre']; ?>" style="min-height: 400px; object-fit: cover;">
            </div>
        </div>
        <div class="col-lg-6">
            <span class="badge-categoria mb-3 d-inline-block"><?php echo $planta['categoria']; ?></span>
            <h1 class="fw-bold mb-2" style="color: var(--verde-oscuro);"><?php echo $planta['nombre']; ?></h1>
            <p class="text-muted fst-italic fs-5 mb-3"><?php echo $planta['nombre_cientifico']; ?></p>
            <h3 class="precio-planta mb-4">$<?php echo number_format($planta['precio'], 0, ',', '.'); ?></h3>
            <p class="lead"><?php echo nl2br($planta['descripcion']); ?></p>
            <div class="d-flex gap-3 mb-4">
                <span class="badge bg-light text-dark border p-2"><i class="bi bi-box-seam me-1"></i>Stock: <?php echo $planta['stock']; ?> unidades</span>
                <span class="badge bg-light text-dark border p-2"><i class="bi bi-truck me-1"></i>Domicilio disponible</span>
            </div>
            <form method="POST" action="<?php echo BASE_URL; ?>/carrito.php" class="d-flex gap-3 align-items-center mb-5">
                <input type="hidden" name="accion" value="agregar">
                <input type="hidden" name="id_planta" value="<?php echo $planta['id_planta']; ?>">
                <div class="input-group" style="width: 140px;">
                    <button class="btn btn-outline-secondary" type="button" onclick="this.parentNode.querySelector('input').stepDown()"><i class="bi bi-dash"></i></button>
                    <input type="number" name="cantidad" value="1" min="1" max="<?php echo $planta['stock']; ?>" class="form-control text-center">
                    <button class="btn btn-outline-secondary" type="button" onclick="this.parentNode.querySelector('input').stepUp()"><i class="bi bi-plus"></i></button>
                </div>
                <button type="submit" class="btn btn-ecoflora btn-lg"><i class="bi bi-cart-plus me-2"></i>Añadir al carrito</button>
            </form>
            <div class="cuidados-box">
                <h5 class="fw-bold mb-3"><i class="bi bi-heart-pulse me-2"></i>Cuidados recomendados</h5>
                <p class="mb-0"><?php echo nl2br($planta['cuidados'] ?: 'Consulta con nuestros expertos para el cuidado ideal de esta planta.'); ?></p>
            </div>
        </div>
    </div>

    <?php if($relacionadas->num_rows > 0): ?>
    <hr class="my-5">
    <h3 class="fw-bold mb-4" style="color: var(--verde-oscuro);"><i class="bi bi-stars me-2"></i>También te puede interesar</h3>
    <div class="row g-4">
        <?php while($r = $relacionadas->fetch_assoc()): ?>
        <div class="col-md-4">
            <div class="card card-planta h-100">
                <div style="overflow: hidden; height: 220px;">
                    <img src="https://placehold.co/600x400/2d6a4f/ffffff?text=<?php echo urlencode($r['nombre']); ?>" class="card-img-top w-100 h-100" alt="<?php echo $r['nombre']; ?>" style="object-fit: cover;">
                </div>
                <div class="card-body d-flex flex-column">
                    <h5 class="card-title fw-bold"><?php echo $r['nombre']; ?></h5>
                    <p class="text-muted small"><em><?php echo $r['nombre_cientifico']; ?></em></p>
                    <div class="d-flex justify-content-between align-items-center mt-auto">
                        <span class="precio-planta">$<?php echo number_format($r['precio'], 0, ',', '.'); ?></span>
                        <a href="<?php echo BASE_URL; ?>/planta.php?id=<?php echo $r['id_planta']; ?>" class="btn btn-sm btn-outline-ecoflora">Ver detalle</a>
                    </div>
                </div>
            </div>
        </div>
        <?php endwhile; ?>
    </div>
    <?php endif; ?>
</div>

<?php include __DIR__ . '/includes/footer.php'; ?>
