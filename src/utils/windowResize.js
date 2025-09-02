export async function resizeLayout() {
    try {
        if (window.electron?.ipcRenderer) {
            const { ipcRenderer } = window.electron;
            const result = await ipcRenderer.invoke('update-sizes');
            if (result.success) {
                logger.info('Window resized for current view');
            } else {
                logger.error('Failed to resize window:', result.error);
            }
        }
    } catch (error) {
        logger.error('Error resizing window:', error);
    }
}