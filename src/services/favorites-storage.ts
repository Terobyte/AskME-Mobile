/**
 * Favorites Storage Service
 * Persists favorite questions using expo-file-system (new API)
 */

import { File, Paths } from 'expo-file-system';

const FAVORITES_FILENAME = 'favorites.json';

export interface FavoriteQuestion {
    id: string;
    topic: string;
    score: number;
    feedback: string;
    userAnswer: string;
    metrics?: {
        accuracy: number;
        depth: number;
        structure: number;
    };
    timestamp: number;
}

/**
 * Get the favorites file reference
 */
const getFavoritesFile = (): File => {
    return new File(Paths.document, FAVORITES_FILENAME);
};

/**
 * Safely parse JSON with validation
 */
const safeParseJSON = (content: string): FavoriteQuestion[] => {
    try {
        if (!content || content.trim() === '') {
            return [];
        }
        const parsed = JSON.parse(content);
        if (!Array.isArray(parsed)) {
            console.warn('⚠️ [FAVORITES] Data is not an array, resetting');
            return [];
        }
        return parsed;
    } catch (error) {
        console.warn('⚠️ [FAVORITES] Invalid JSON, resetting to empty array');
        return [];
    }
};

/**
 * Get all saved favorites
 */
export const getFavorites = async (): Promise<FavoriteQuestion[]> => {
    try {
        const file = getFavoritesFile();

        if (!file.exists) {
            console.log('📂 [FAVORITES] No favorites file exists yet');
            return [];
        }

        const content = file.text() as unknown as string;
        const favorites = safeParseJSON(content);
        console.log(`⭐ [FAVORITES] Loaded ${favorites.length} favorites`);
        return favorites;
    } catch (error) {
        console.error('❌ [FAVORITES] Failed to load:', error);
        return [];
    }
};

/**
 * Check if a question is favorited
 */
export const isFavorite = async (id: string): Promise<boolean> => {
    const favorites = await getFavorites();
    return favorites.some(f => f.id === id);
};

/**
 * Toggle favorite status (add if not exists, remove if exists)
 * Returns: { added: boolean, favorites: FavoriteQuestion[] }
 */
export const toggleFavorite = async (question: FavoriteQuestion): Promise<{
    added: boolean;
    favorites: FavoriteQuestion[];
}> => {
    try {
        const favorites = await getFavorites();
        const existingIndex = favorites.findIndex(f => f.id === question.id);

        let added: boolean;

        if (existingIndex >= 0) {
            // Remove from favorites
            favorites.splice(existingIndex, 1);
            added = false;
            console.log(`⭐ [FAVORITES] Removed: ${question.topic}`);
        } else {
            // Add to favorites with current timestamp
            favorites.push({
                ...question,
                timestamp: Date.now(),
            });
            added = true;
            console.log(`⭐ [FAVORITES] Added: ${question.topic}`);
        }

        // Save to file using new File API
        const file = getFavoritesFile();
        const jsonString = JSON.stringify(favorites, null, 2);
        file.write(jsonString);

        console.log(`⭐ [FAVORITES] Total count: ${favorites.length}`);
        return { added, favorites };
    } catch (error) {
        console.error('❌ [FAVORITES] Toggle failed:', error);
        // Return current state on failure
        const current = await getFavorites();
        return { added: false, favorites: current };
    }
};

/**
 * Get favorite IDs as a Set (for quick lookup)
 */
export const getFavoriteIds = async (): Promise<Set<string>> => {
    const favorites = await getFavorites();
    return new Set(favorites.map(f => f.id));
};

/**
 * Clear all favorites (reset corrupted data)
 */
export const clearFavorites = async (): Promise<void> => {
    try {
        const file = getFavoritesFile();
        file.write('[]');
        console.log('🗑️ [FAVORITES] Cleared all favorites');
    } catch (error) {
        console.error('❌ [FAVORITES] Failed to clear:', error);
    }
};
