import { IconsAPI } from '../services/api';

// Icon cache to avoid repeated API calls
let iconCache = null;
let iconImages = {};
let loadingPromise = null;

// Mapping from frontend device types to Laravel icon IDs
let deviceTypeToIconId = {};

/**
 * Load all icons from Laravel backend and cache them
 * @returns {Promise<Object>} Map of icon ID to Image object
 */
export async function loadIcons() {
  // Return cached icons if already loaded
  if (iconCache) {
    return iconCache;
  }

  // If already loading, return the same promise
  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = (async () => {
    try {
      const icons = await IconsAPI.getIcons();
      
      // Create a map of icon ID to URL
      iconCache = {};
      
      // Preload all images
      const loadPromises = icons.map(icon => {
        return new Promise((resolve, reject) => {
          const img = new Image();
          
          // Fix the icon URL - remove 'storage/' if present and ensure correct path
          let iconUrl = icon.icon;
          if (iconUrl.includes('storage/icon/')) {
            iconUrl = iconUrl.replace('storage/icon/', 'icon/');
          }
          
          // Use icon ID as the key for reliable mapping
          const iconId = icon.id;
          
          img.onload = () => {
            iconImages[iconId] = img;
            iconCache[iconId] = iconUrl;
            resolve();
          };
          img.onerror = () => {
            console.warn(`Failed to load icon ID ${iconId}: ${icon.name} from ${iconUrl}`);
            resolve(); // Resolve anyway to not block other icons
          };
          img.src = iconUrl;
        });
      });

      await Promise.all(loadPromises);
      
      // Build mapping from device type to icon ID
      icons.forEach(icon => {
        // وحّد الفراغات والشرطات إلى "_" (مو بس الفراغات) مشان أسماء
        // مركّبة متل "Core Switch" أو "Core-Switch" توصل لنفس المفتاح "core_switch"
        const normalizedName = icon.name.toLowerCase().trim().replace(/[\s-]+/g, '_');
        
        // Map each icon to its ID
        deviceTypeToIconId[normalizedName] = icon.id;
      });
      
      // Special mappings for name variations
      if (deviceTypeToIconId['home_router']) {
        deviceTypeToIconId['homerouter'] = deviceTypeToIconId['home_router'];
      }
      if (deviceTypeToIconId['fire_wall']) {
        deviceTypeToIconId['firewall'] = deviceTypeToIconId['fire_wall'];
      }
      // Core Switch — دعم كل الأشكال الممكنة يلي ممكن يجي فيها الاسم من الباك-إند
      if (!deviceTypeToIconId['core_switch'] && deviceTypeToIconId['coreswitch']) {
        deviceTypeToIconId['core_switch'] = deviceTypeToIconId['coreswitch'];
      }
      if (!deviceTypeToIconId['coreswitch'] && deviceTypeToIconId['core_switch']) {
        deviceTypeToIconId['coreswitch'] = deviceTypeToIconId['core_switch'];
      }
      
      console.log('Icons loaded successfully:', Object.keys(iconCache).length, 'icons');
      console.log('Icon IDs:', Object.keys(iconCache));
      console.log('Device Type to Icon ID Mapping:', deviceTypeToIconId);
      return iconCache;
    } catch (error) {
      console.error('Failed to load icons:', error);
      iconCache = {}; // Set empty cache to prevent repeated failed attempts
      return iconCache;
    } finally {
      loadingPromise = null;
    }
  })();

  return loadingPromise;
}

/**
 * Get a specific icon image by device type
 * @param {string} deviceType - Device type (e.g., 'router', 'switch', 'firewall')
 * @returns {Image|null} Image object or null if not found
 */
export function getIconImage(deviceType) {
  const iconId = deviceTypeToIconId[deviceType.toLowerCase()];
  if (iconId) {
    return iconImages[iconId] || null;
  }
  return null;
}

/**
 * Get icon URL by device type
 * @param {string} deviceType - Device type
 * @returns {string|null} Icon URL or null if not found
 */
export function getIconUrl(deviceType) {
  const iconId = deviceTypeToIconId[deviceType.toLowerCase()];
  if (iconId) {
    return iconCache[iconId] || null;
  }
  return null;
}

/**
 * Get all icon URLs mapped by device type
 * @returns {Object} Map of device type to icon URL
 */
export function getAllIconUrls() {
  const urls = {};
  Object.keys(deviceTypeToIconId).forEach(deviceType => {
    const iconId = deviceTypeToIconId[deviceType];
    urls[deviceType] = iconCache[iconId] || null;
  });
  return urls;
}

/**
 * Get icon by ID directly
 * @param {number} iconId - Icon ID from database
 * @returns {Image|null} Image object or null if not found
 */
export function getIconImageById(iconId) {
  return iconImages[iconId] || null;
}

/**
 * Get icon URL by ID directly
 * @param {number} iconId - Icon ID from database
 * @returns {string|null} Icon URL or null if not found
 */
export function getIconUrlById(iconId) {
  return iconCache[iconId] || null;
}

/**
 * Check if icons are loaded
 * @returns {boolean}
 */
export function areIconsLoaded() {
  return iconCache !== null;
}

/**
 * Clear icon cache (useful for testing or reloading)
 */
export function clearIconCache() {
  iconCache = null;
  iconImages = {};
  deviceTypeToIconId = {};
  loadingPromise = null;
}
