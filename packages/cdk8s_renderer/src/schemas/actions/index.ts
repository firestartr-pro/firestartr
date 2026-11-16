import { apps, platforms, dockerRegistries } from '../dot-firestartr';
import buildImagesResults from './build_images_results.schema';
import config from './config.schema';

export { buildImagesResults, config };

export const schemas = {
  'firestartr-apps': apps,
  'firestartr-platforms': platforms,
  'firestartr-registries': dockerRegistries,
  'build-images-results': buildImagesResults,
  config,
};
