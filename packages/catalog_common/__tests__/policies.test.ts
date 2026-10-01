import { policiesAreCompatible } from "../src/policies/policies";


describe('policiesAreCompatible', () => {
    
    it('should return true for compatible policies', () => {
    
        expect(policiesAreCompatible('apply', 'full-control')).toBe(true);
    
        expect(policiesAreCompatible('create-update-only', 'apply')).toBe(true);
    
        expect(policiesAreCompatible('observe', 'full-control')).toBe(true);
    
        expect(policiesAreCompatible('observe-only', 'observe')).toBe(true);
    
    });
  
    it('should return false for incompatible policies', () => {
    
        expect(policiesAreCompatible('apply', 'observe-only')).toBe(false);
    
        expect(policiesAreCompatible('apply', 'observe')).toBe(false);
    
    });  
  
});
