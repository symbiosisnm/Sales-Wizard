export async function resizeLayout() {
    try {
        if (window.electron?.updateSizes) {
            const result = await window.electron.updateSizes();
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