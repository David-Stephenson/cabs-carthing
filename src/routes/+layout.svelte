<script>
  import '../app.css';

  let { children } = $props();
</script>

<div class="layout-root">
  <main class="main">
    {@render children()}
  </main>
</div>

<style>
  .layout-root {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-height: 100dvh;
    height: 100dvh;
    overflow: hidden;
    background: #0a0a0c;
  }

  .main {
    flex: 1;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    background: #0a0a0c;
  }
</style>
