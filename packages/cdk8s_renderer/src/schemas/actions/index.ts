import { apps, platforms, dockerRegistries } from '../dot-firestartr';
import buildImages from './build_images.schema';
import buildImagesResults from './build_images_results.schema';
import config from './config.schema';

export { buildImages, buildImagesResults, config };

export const schemas = {
  'firestartr-apps': apps,
  'firestartr-platforms': platforms,
  'firestartr-registries': dockerRegistries,
  'build-images': buildImages,
  'build-images-results': buildImagesResults,
  config,
};
